import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { setMailer, type MailMessage, type Mailer } from "../lib/mail/index.js";
import { getTestApp, resetData } from "./helpers.js";

/**
 * Telling someone their verification email could not be sent.
 *
 * They just created this account themselves, so saying so reveals nothing and
 * saves them watching an inbox nothing is coming to. The catch is that the
 * same answer must come back for an address that already has an account, or a
 * sender that is down becomes a way to find out who is registered.
 */

const PASSWORD = "a sufficiently long password";

function mailer(send: (message: MailMessage) => Promise<void>): Mailer {
  return { name: "memory", send };
}

const sent: MailMessage[] = [];
const working = mailer(async (message) => {
  sent.push(message);
});
const broken = mailer(async () => {
  throw new Error("Brevo refused the message (401): key expired");
});

async function signUp(email: string, username: string) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, username, password: PASSWORD, displayName: "Outcome Test", role: "client" },
  });
}

describe("what registration says about the email", () => {
  beforeEach(async () => {
    await resetData();
    sent.length = 0;
  });

  afterEach(() => {
    setMailer(undefined);
  });

  it("says the link went out when it did", async () => {
    setMailer(working);
    const response = await signUp("fine@example.com", "fineuser");
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      status: "verification_sent",
      email: "fine@example.com",
      emailSent: true,
    });
  });

  it("says it did not when the sender refuses, and keeps the account", async () => {
    setMailer(broken);
    const response = await signUp("nolink@example.com", "nolinkuser");
    expect(response.statusCode).toBe(202);
    expect(response.json().emailSent).toBe(false);

    const account = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM users WHERE username = 'nolinkuser'`,
    );
    expect(Number(account?.cnt)).toBe(1);
  });

  it("answers a taken address exactly as a free one while the sender is down", async () => {
    setMailer(working);
    await signUp("taken@example.com", "takenuser");
    await db.run(`UPDATE users SET email_verified_at = SYSTIMESTAMP`);

    // Every send now fails, which is the moment the difference would leak.
    setMailer(broken);
    const free = await signUp("brandnew@example.com", "brandnewuser");
    const takenAgain = await signUp("taken@example.com", "someoneelse");

    expect(takenAgain.statusCode).toBe(free.statusCode);
    expect(takenAgain.json().emailSent).toBe(free.json().emailSent);
    expect(takenAgain.json().emailSent).toBe(false);
  });

  it("says the email went out when the hourly notice limit stopped a confirmed account's note", async () => {
    setMailer(working);
    await signUp("hourly@example.com", "hourlyuser");
    await db.run(`UPDATE users SET email_verified_at = SYSTIMESTAMP`);

    const first = await signUp("hourly@example.com", "hourlytry1");
    expect(first.json().emailSent).toBe(true);
    expect(sent.some((message) => message.subject === "You already have a Craftbid account")).toBe(true);

    // The second is inside the hour, so nothing is attempted. Nothing
    // attempted is not a failure, and must not be reported as one.
    sent.length = 0;
    const second = await signUp("hourly@example.com", "hourlytry2");
    expect(second.json().emailSent).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("says the email went out when a limit meant nothing was attempted", async () => {
    setMailer(working);
    await signUp("limited@example.com", "limiteduser");
    sent.length = 0;

    // Unconfirmed account, so this path resends; the one-a-minute limit means
    // no send happens. Nothing was attempted, so there is nothing to report.
    const again = await signUp("limited@example.com", "limiteduser2");
    expect(again.json().emailSent).toBe(true);
    expect(sent).toHaveLength(0);
  });
});
