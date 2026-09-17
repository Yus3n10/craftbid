import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { uuidToBuf } from "../db/ids.js";
import { setMailer, type MailMessage, type Mailer } from "../lib/mail/index.js";
import { getTestApp, registerUser, resetData, type Session } from "./helpers.js";

/**
 * Password reset.
 *
 * Someone who forgot their password had no way back in. A link sent to the
 * account's address sets a new one. The answer to "send me a link" never says
 * whether an address has an account, and a reset signs every device out.
 */

const sent: MailMessage[] = [];
const memoryMailer: Mailer = {
  name: "memory",
  async send(message) {
    sent.push(message);
  },
};

const OLD_PASSWORD = "a sufficiently long password";
const NEW_PASSWORD = "a brand new long passphrase";

function tokenFrom(message: MailMessage | undefined): string {
  const match = message?.text.match(/reset-password\?token=([A-Za-z0-9_-]{43})/);
  if (!match) throw new Error(`No reset link in: ${message?.text}`);
  return match[1]!;
}

async function waitForMail(count: number): Promise<void> {
  for (let i = 0; i < 50 && sent.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function forgot(email: string) {
  const app = await getTestApp();
  return app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email } });
}

async function reset(token: string, password = NEW_PASSWORD) {
  const app = await getTestApp();
  return app.inject({ method: "POST", url: "/auth/reset-password", payload: { token, password } });
}

async function login(user: Session, password: string) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: `${user.username}@example.com`, password },
  });
}

describe("password reset", () => {
  let user: Session;

  beforeEach(async () => {
    await resetData();
    sent.length = 0;
    // Registered with email switched off, so the account is signed in and
    // usable; then the mailer is switched on for the reset itself.
    user = await registerUser("client");
    setMailer(memoryMailer);
  });

  afterEach(() => {
    setMailer(undefined);
  });

  it("emails a link to a registered address, and answers a stranger's address the same way", async () => {
    const known = await forgot(`${user.username}@example.com`);
    const unknown = await forgot("nobody-here@example.com");

    expect(known.statusCode).toBe(204);
    expect(unknown.statusCode).toBe(204);
    await waitForMail(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(`${user.username}@example.com`);
    expect(sent[0]!.html).toContain("reset-password?token=");
  });

  it("sets the new password, signs every device out, and works only once", async () => {
    const app = await getTestApp();
    const signedIn = await login(user, OLD_PASSWORD);
    const refreshToken = signedIn.json().refreshToken as string;

    await forgot(`${user.username}@example.com`);
    await waitForMail(1);
    const token = tokenFrom(sent[0]);

    expect((await reset(token)).statusCode).toBe(204);

    expect((await login(user, OLD_PASSWORD)).statusCode).toBe(401);
    expect((await login(user, NEW_PASSWORD)).statusCode).toBe(200);

    // Whoever else held a session (the reason people reset) is out.
    const refreshed = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(401);

    const again = await reset(token, "yet another long passphrase");
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("link_used");
  });

  it("refuses an expired link", async () => {
    await forgot(`${user.username}@example.com`);
    await waitForMail(1);
    const token = tokenFrom(sent[0]);
    await db.run(
      `UPDATE password_reset_tokens SET expires_at = SYSTIMESTAMP - INTERVAL '1' MINUTE WHERE user_id = :id`,
      { id: uuidToBuf(user.id) },
    );

    const response = await reset(token);
    expect(response.statusCode).toBe(410);
    expect(response.json().error.code).toBe("link_expired");
    expect((await login(user, OLD_PASSWORD)).statusCode).toBe(200);
  });

  it("refuses a made-up link and a short password", async () => {
    const madeUp = await reset("A".repeat(43));
    expect(madeUp.statusCode).toBe(400);
    expect(madeUp.json().error.code).toBe("link_invalid");

    await forgot(`${user.username}@example.com`);
    await waitForMail(1);
    const short = await reset(tokenFrom(sent[0]), "short");
    expect(short.statusCode).toBe(400);
    expect(short.json().error.fields.password).toBeDefined();
  });

  it("makes an earlier link stop working once a newer one is used", async () => {
    await forgot(`${user.username}@example.com`);
    await waitForMail(1);
    const first = tokenFrom(sent[0]);
    // The one-a-minute limit would otherwise hold back the second link.
    await db.run(
      `UPDATE password_reset_tokens SET created_at = SYSTIMESTAMP - INTERVAL '2' MINUTE WHERE user_id = :id`,
      { id: uuidToBuf(user.id) },
    );
    await forgot(`${user.username}@example.com`);
    await waitForMail(2);
    const second = tokenFrom(sent[1]);

    expect((await reset(second)).statusCode).toBe(204);
    expect((await reset(first, "yet another long passphrase")).statusCode).toBe(409);
  });

  it("sends at most one link a minute to the same account, silently", async () => {
    await forgot(`${user.username}@example.com`);
    await forgot(`${user.username}@example.com`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(sent).toHaveLength(1);
  });

  it("confirms the email of an account that had not, since the link proves the inbox", async () => {
    await db.run(`UPDATE users SET email_verified_at = NULL WHERE id = :id`, { id: uuidToBuf(user.id) });
    await forgot(`${user.username}@example.com`);
    await waitForMail(1);
    await reset(tokenFrom(sent[0]));

    const row = await db.one<{ verifiedAt: Date | null }>(
      `SELECT email_verified_at AS verified_at FROM users WHERE id = :id`,
      { id: uuidToBuf(user.id) },
    );
    expect(row?.verifiedAt).not.toBeNull();
  });

  it("sends nothing to a suspended account", async () => {
    await db.run(`UPDATE users SET status = 'suspended' WHERE id = :id`, { id: uuidToBuf(user.id) });
    expect((await forgot(`${user.username}@example.com`)).statusCode).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(sent).toHaveLength(0);
  });
});

describe("password reset with email switched off", () => {
  beforeEach(async () => {
    await resetData();
    sent.length = 0;
    setMailer(undefined);
  });

  it("answers the same and sends nothing", async () => {
    const user = await registerUser("artist");
    expect((await forgot(`${user.username}@example.com`)).statusCode).toBe(204);
    expect(sent).toHaveLength(0);
  });
});
