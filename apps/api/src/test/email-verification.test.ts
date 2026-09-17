import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { createBrevoMailer, setMailer, type MailMessage, type Mailer } from "../lib/mail/index.js";
import { resendVerification } from "../modules/auth/auth.service.js";
import { verificationEmail } from "../modules/auth/verification-email.js";
import {
  authHeaders,
  createArtistPost,
  getTestApp,
  registerUser,
  resetData,
  type Session,
} from "./helpers.js";

/**
 * Email verification.
 *
 * New accounts prove their address before they are signed in; accounts that
 * already existed keep signing in and are refused the actions that put
 * something in front of other people until they verify. None of it applies
 * while no email service is configured.
 */

const sent: MailMessage[] = [];
const memoryMailer: Mailer = {
  name: "memory",
  async send(message) {
    sent.push(message);
  },
};

const PASSWORD = "a sufficiently long password";

function tokenFrom(message: MailMessage | undefined): string {
  const match = message?.text.match(/verify-email\?token=([A-Za-z0-9_-]{43})/);
  if (!match) throw new Error(`No verification link in: ${message?.text}`);
  return match[1]!;
}

async function waitForMail(count: number): Promise<void> {
  for (let i = 0; i < 50 && sent.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function registerUnverified(role: "client" | "artist", username: string) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: `${username}@example.com`, username, password: PASSWORD, displayName: "Nena <b>Hooks</b>", role },
  });
}

async function login(username: string): Promise<Session & { cookies: string }> {
  const app = await getTestApp();
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: `${username}@example.com`, password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  const body = response.json();
  return {
    id: body.user.id,
    username,
    token: body.accessToken,
    role: body.user.role,
    cookies: "",
  };
}

describe("email verification, switched on", () => {
  beforeEach(async () => {
    await resetData();
    sent.length = 0;
    setMailer(memoryMailer);
  });

  afterEach(() => {
    setMailer(undefined);
  });

  it("creates the account without signing in, and emails a link", async () => {
    const response = await registerUnverified("artist", "newartist");
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "verification_sent", email: "newartist@example.com" });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.json().accessToken).toBeUndefined();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("newartist@example.com");
    expect(sent[0]!.text).toContain("http://localhost:5173/verify-email?token=");
    // A display name is user input and must not become markup in the email.
    expect(sent[0]!.html).not.toContain("<b>Hooks</b>");
    expect(sent[0]!.html).toContain("&lt;b&gt;Hooks&lt;/b&gt;");

    // Only the hash is stored, never the token in the link.
    const token = tokenFrom(sent[0]);
    const stored = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM email_verification_tokens WHERE token_hash = :token`,
      { token },
    );
    expect(Number(stored?.cnt)).toBe(0);
  });

  it("lets an unverified account sign in and browse, and refuses posting, bidding and social actions", async () => {
    await registerUnverified("artist", "waiting");
    const app = await getTestApp();
    const session = await login("waiting");

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: authHeaders(session) });
    expect(me.json().emailVerified).toBe(false);

    const feed = await app.inject({ method: "GET", url: "/feed", headers: authHeaders(session) });
    expect(feed.statusCode).toBe(200);

    const profile = await app.inject({
      method: "PATCH",
      url: "/me/profile",
      headers: authHeaders(session),
      payload: { bio: "Still allowed to fill in my profile." },
    });
    expect(profile.statusCode).toBe(200);

    const post = await app.inject({
      method: "POST",
      url: "/posts",
      headers: authHeaders(session),
      payload: { caption: "x", imageIds: ["01920000-0000-7000-8000-000000000001"] },
    });
    expect(post.statusCode).toBe(403);
    expect(post.json().error.code).toBe("email_unverified");
  });

  it("refuses reacting, commenting, saving and sharing until verified", async () => {
    // The post comes from an account made before verification was switched on.
    setMailer(undefined);
    const artist = await registerUser("artist");
    await db.run(`UPDATE users SET email_verified_at = SYSTIMESTAMP WHERE username = :u`, { u: artist.username });
    const postId = (await createArtistPost(artist)).id;
    setMailer(memoryMailer);

    await registerUnverified("client", "lurker");
    const session = await login("lurker");
    const app = await getTestApp();
    const headers = authHeaders(session);

    const attempts = [
      app.inject({ method: "PUT", url: `/posts/${postId}/reaction`, headers, payload: { kind: "love" } }),
      app.inject({ method: "POST", url: `/posts/${postId}/comments`, headers, payload: { body: "hi" } }),
      app.inject({ method: "PUT", url: `/posts/${postId}/save`, headers }),
      app.inject({ method: "PUT", url: `/posts/${postId}/share`, headers, payload: {} }),
      app.inject({
        method: "POST",
        url: "/postings",
        headers,
        payload: { title: "A request", description: "Long enough description for a craft request here.", categorySlug: "crochet", minBudgetCentavos: 100_000, imageIds: [] },
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("email_unverified");
    }
  });

  it("verifies through the link, signs that person in, and then allows the actions", async () => {
    await registerUnverified("artist", "clicker");
    const app = await getTestApp();
    const token = tokenFrom(sent[0]);

    const verified = await app.inject({ method: "POST", url: "/auth/verify-email", payload: { token } });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().user.emailVerified).toBe(true);
    const cookies = [verified.headers["set-cookie"]].flat().join(" ");
    expect(cookies).toContain("craftbid_at=");
    expect(cookies).toContain("craftbid_rt=");

    const session = { id: verified.json().user.id, username: "clicker", token: verified.json().accessToken, role: "artist" as const };
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: authHeaders(session) });
    expect(me.json().emailVerified).toBe(true);

    const post = await app.inject({
      method: "POST",
      url: "/posts",
      headers: authHeaders(session),
      payload: { caption: "x", imageIds: ["01920000-0000-7000-8000-000000000001"] },
    });
    // Past the verification gate: refused now only because the image is not theirs.
    expect(post.json().error?.code).not.toBe("email_unverified");
  });

  it("works once: the same link again says the email is already confirmed", async () => {
    await registerUnverified("client", "twice");
    const app = await getTestApp();
    const token = tokenFrom(sent[0]);
    await app.inject({ method: "POST", url: "/auth/verify-email", payload: { token } });

    const again = await app.inject({ method: "POST", url: "/auth/verify-email", payload: { token } });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("already_verified");
    expect(again.headers["set-cookie"]).toBeUndefined();
  });

  it("stops every other link once one is used", async () => {
    await registerUnverified("client", "manylinks");
    const app = await getTestApp();
    const first = tokenFrom(sent[0]);
    // A second link, sent more than a minute later.
    await db.run(
      `UPDATE email_verification_tokens SET created_at = created_at - INTERVAL '2' MINUTE`,
    );
    await app.inject({ method: "POST", url: "/auth/resend-verification", payload: { email: "manylinks@example.com" } });
    await waitForMail(2);
    const second = tokenFrom(sent[1]);
    expect(second).not.toBe(first);

    expect((await app.inject({ method: "POST", url: "/auth/verify-email", payload: { token: second } })).statusCode).toBe(200);
    const old = await app.inject({ method: "POST", url: "/auth/verify-email", payload: { token: first } });
    expect(old.statusCode).toBe(409);
  });

  it("refuses an expired link and an invented one", async () => {
    await registerUnverified("client", "slow");
    const app = await getTestApp();
    await db.run(`UPDATE email_verification_tokens SET expires_at = SYSTIMESTAMP - INTERVAL '1' MINUTE`);

    const expired = await app.inject({ method: "POST", url: "/auth/verify-email", payload: { token: tokenFrom(sent[0]) } });
    expect(expired.statusCode).toBe(410);

    const invented = await app.inject({
      method: "POST",
      url: "/auth/verify-email",
      payload: { token: "A".repeat(43) },
    });
    expect(invented.statusCode).toBe(400);

    const malformed = await app.inject({ method: "POST", url: "/auth/verify-email", payload: { token: "short" } });
    expect(malformed.statusCode).toBe(400);
  });

  it("answers a resend the same way for an unknown address, and sends nothing", async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/resend-verification",
      payload: { email: "nobody@example.com" },
    });
    expect(response.statusCode).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent).toHaveLength(0);
  });

  it("limits resends to one a minute, silently", async () => {
    await registerUnverified("client", "impatient");
    const app = await getTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/resend-verification",
      payload: { email: "impatient@example.com" },
    });
    expect(response.statusCode).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent).toHaveLength(1);
  });

  it("sends one link when several resends arrive at the same moment", async () => {
    await registerUnverified("client", "doubletap");
    // The first rounds run on a cold connection pool, which happens to queue
    // the requests one after another, so the race needs several trials.
    for (let trial = 0; trial < 6; trial += 1) {
      await db.run(`UPDATE email_verification_tokens SET created_at = created_at - INTERVAL '2' HOUR`);
      const before = sent.length;
      await Promise.all(
        Array.from({ length: 8 }, () => resendVerification({ email: "doubletap@example.com" })),
      );
      expect(sent.length - before).toBe(1);
    }
  });

  it("sends nothing to an address that is already verified", async () => {
    await registerUnverified("client", "done");
    const app = await getTestApp();
    await app.inject({ method: "POST", url: "/auth/verify-email", payload: { token: tokenFrom(sent[0]) } });
    await db.run(`UPDATE email_verification_tokens SET created_at = created_at - INTERVAL '2' MINUTE`);

    await app.inject({ method: "POST", url: "/auth/resend-verification", payload: { email: "done@example.com" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent).toHaveLength(1);
  });

  it("asks an account from before verification existed to verify, and sends its link when signed in", async () => {
    setMailer(undefined);
    const existing = await registerUser("client");
    setMailer(memoryMailer);
    const app = await getTestApp();

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: authHeaders(existing) });
    expect(me.json().emailVerified).toBe(false);

    const resend = await app.inject({
      method: "POST",
      url: "/auth/resend-verification",
      headers: authHeaders(existing),
      payload: {},
    });
    expect(resend.statusCode).toBe(204);
    await waitForMail(1);
    expect(sent[0]!.to).toBe(`${existing.username}@example.com`);
  });
});

describe("email verification, switched off", () => {
  beforeEach(async () => {
    await resetData();
    setMailer(undefined);
  });

  it("signs in on registration and treats every account as verified", async () => {
    const session = await registerUser("client");
    const app = await getTestApp();
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: authHeaders(session) });
    expect(me.json().emailVerified).toBe(true);

    const resend = await app.inject({
      method: "POST",
      url: "/auth/resend-verification",
      headers: authHeaders(session),
      payload: {},
    });
    expect(resend.statusCode).toBe(204);
  });
});

describe("the Brevo driver", () => {
  it("sends the message in Brevo's shape with the key in the header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"messageId":"x"}', { status: 201 });
    }) as unknown as typeof fetch;

    const mailer = createBrevoMailer(fakeFetch, { apiKey: "xkeysib-test", fromEmail: "craftbid.ph@gmail.com", fromName: "Craftbid" });
    await mailer.send(verificationEmail({ to: "a@example.com", displayName: "Ana", link: "https://craftbid.test/verify-email?token=abc", hoursValid: 24 }));

    expect(calls[0]!.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((calls[0]!.init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-test");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.sender).toEqual({ name: "Craftbid", email: "craftbid.ph@gmail.com" });
    expect(body.to).toEqual([{ email: "a@example.com", name: "Ana" }]);
    expect(body.textContent).toContain("https://craftbid.test/verify-email?token=abc");
  });

  it("reports a refusal without repeating the key", async () => {
    const fakeFetch = (async () => new Response('{"code":"unauthorized"}', { status: 401 })) as unknown as typeof fetch;
    const mailer = createBrevoMailer(fakeFetch, { apiKey: "xkeysib-secret", fromEmail: "a@b.co", fromName: "Craftbid" });
    const error = await mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "h" }).catch((e: Error) => e);
    expect(String(error)).toContain("401");
    expect(String(error)).not.toContain("xkeysib-secret");
  });
});
