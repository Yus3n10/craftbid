import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { setMailer, type MailMessage, type Mailer } from "../lib/mail/index.js";
import { getTestApp, resetData } from "./helpers.js";

/**
 * Signing up must not reveal which emails have accounts. With email
 * verification on, an address that is taken gets the same answer as a new
 * one, and the owner hears about it by email.
 */

const sent: MailMessage[] = [];
const memoryMailer: Mailer = {
  name: "memory",
  async send(message) {
    sent.push(message);
  },
};

const PASSWORD = "a sufficiently long password";

async function signUp(email: string, username: string) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, username, password: PASSWORD, displayName: "Privacy Test", role: "client" },
  });
}

function verificationToken(message: MailMessage): string {
  const match = message.text.match(/verify-email\?token=([A-Za-z0-9_-]{43})/);
  if (!match) throw new Error(`No verification link in: ${message.text}`);
  return match[1]!;
}

describe("sign-up with an address that already has an account", () => {
  beforeEach(async () => {
    await resetData();
    sent.length = 0;
    setMailer(memoryMailer);
  });

  afterEach(() => {
    setMailer(undefined);
  });

  it("answers exactly as for a new address, and tells the confirmed owner by email", async () => {
    const fresh = await signUp("owner@example.com", "owner");
    const app = await getTestApp();
    await app.inject({ method: "POST", url: "/auth/verify-email", payload: { token: verificationToken(sent[0]!) } });
    sent.length = 0;

    const taken = await signUp("owner@example.com", "someoneelse");
    expect(taken.statusCode).toBe(fresh.statusCode);
    expect(taken.json()).toEqual({ status: "verification_sent", email: "owner@example.com" });
    expect(taken.headers["set-cookie"]).toBeUndefined();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("owner@example.com");
    expect(sent[0]!.subject).toBe("You already have a Craftbid account");
    expect(sent[0]!.text).toContain("http://localhost:5173/forgot-password");
    // No second account was made.
    const accounts = await db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM users WHERE username = 'someoneelse'`);
    expect(Number(accounts?.cnt)).toBe(0);
  });

  it("sends that note at most once an hour", async () => {
    await signUp("busy@example.com", "busy");
    await db.run(`UPDATE users SET email_verified_at = SYSTIMESTAMP`);
    sent.length = 0;

    await signUp("busy@example.com", "tryone");
    await signUp("busy@example.com", "trytwo");
    expect(sent).toHaveLength(1);

    await db.run(`UPDATE users SET account_exists_notice_at = account_exists_notice_at - INTERVAL '61' MINUTE`);
    await signUp("busy@example.com", "trythree");
    expect(sent).toHaveLength(2);
  });

  it("sends an unconfirmed owner a fresh verification link instead", async () => {
    await signUp("forgetful@example.com", "forgetful");
    await db.run(`UPDATE email_verification_tokens SET created_at = created_at - INTERVAL '2' MINUTE`);
    sent.length = 0;

    const again = await signUp("forgetful@example.com", "forgetful2");
    expect(again.statusCode).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Confirm your email for Craftbid");
  });

  it("still says a username is taken, since usernames are public", async () => {
    await signUp("first@example.com", "samename");
    const clash = await signUp("second@example.com", "samename");
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.fields.username).toBe("That username is taken.");
  });
});

describe("sign-up with verification switched off", () => {
  beforeEach(async () => {
    await resetData();
    setMailer(undefined);
  });

  it("keeps saying the email is registered, since there is no inbox to tell instead", async () => {
    expect((await signUp("plain@example.com", "plain")).statusCode).toBe(201);
    const clash = await signUp("plain@example.com", "plain2");
    expect(clash.statusCode).toBe(409);
  });
});
