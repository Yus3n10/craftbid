import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { setMailer, type MailMessage, type Mailer } from "../lib/mail/index.js";
import { sendMail } from "../lib/mail/send.js";
import { recentMail, failureCount } from "../lib/mail/mail-log.repository.js";
import { getTestApp, resetData } from "./helpers.js";

/**
 * Every outbound email is recorded with what became of it.
 *
 * A send that fails is invisible otherwise: the person is told to check an
 * inbox nothing will arrive in, and the only trace is a line in a log nobody
 * reads. That is how an expired Brevo key went unnoticed for days.
 */

const PASSWORD = "a sufficiently long password";

function mailer(send: (message: MailMessage) => Promise<void>): Mailer {
  return { name: "memory", send };
}

const working = (sent: MailMessage[]) =>
  mailer(async (message) => {
    sent.push(message);
  });

const broken = () =>
  mailer(async () => {
    throw new Error("Brevo refused the message (401): key expired");
  });

async function signUp(email: string, username: string) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, username, password: PASSWORD, displayName: "Mail Log", role: "client" },
  });
}

describe("the mail log", () => {
  beforeEach(async () => {
    await resetData();
  });

  afterEach(() => {
    setMailer(undefined);
  });

  it("records a sent verification email", async () => {
    const sent: MailMessage[] = [];
    setMailer(working(sent));

    await signUp("logged@example.com", "logged");

    const rows = await recentMail(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "verification",
      recipient: "logged@example.com",
      status: "sent",
      driver: "memory",
      error: null,
    });
  });

  it("records a failed send with the reason, and still creates the account", async () => {
    setMailer(broken());

    const response = await signUp("doomed@example.com", "doomed");
    expect(response.statusCode).toBe(202);

    const rows = await recentMail(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.error).toContain("401");
    expect(await failureCount(24)).toBe(1);

    // The account exists, so the person can ask for another link.
    const account = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM users WHERE username = 'doomed'`,
    );
    expect(Number(account?.cnt)).toBe(1);
  });

  it("never stores the link or the body", async () => {
    const sent: MailMessage[] = [];
    setMailer(working(sent));
    await signUp("private@example.com", "privateuser");

    const stored = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM mail_log WHERE subject LIKE '%token%' OR error LIKE '%token%'`,
    );
    expect(Number(stored?.cnt)).toBe(0);
    const token = sent[0]!.text.match(/token=([A-Za-z0-9_-]+)/)![1]!;
    const leaked = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM mail_log WHERE subject LIKE :needle OR error LIKE :needle`,
      { needle: `%${token}%` },
    );
    expect(Number(leaked?.cnt)).toBe(0);
  });

  it("records a password reset by its own kind", async () => {
    const sent: MailMessage[] = [];
    setMailer(working(sent));
    await signUp("resetme@example.com", "resetme");
    await db.run(`UPDATE users SET email_verified_at = SYSTIMESTAMP`);

    const app = await getTestApp();
    await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "resetme@example.com" } });
    for (let i = 0; i < 50 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 50));

    const kinds = (await recentMail(10)).map((row) => row.kind);
    expect(kinds).toContain("password_reset");
  });

  it("delivers the email even when the log write fails", async () => {
    const sent: MailMessage[] = [];
    setMailer(working(sent));
    await db.run(`ALTER TABLE mail_log RENAME TO mail_log_hidden`);
    try {
      await expect(
        sendMail("verification", { to: "x@example.com", subject: "s", text: "t", html: "<p>t</p>" }),
      ).resolves.toBeUndefined();
      expect(sent).toHaveLength(1);
    } finally {
      await db.run(`ALTER TABLE mail_log_hidden RENAME TO mail_log`);
    }
  });

  it("reports a send failure to its caller", async () => {
    setMailer(broken());
    await expect(
      sendMail("verification", { to: "x@example.com", subject: "s", text: "t", html: "<p>t</p>" }),
    ).rejects.toThrow(/401/);
  });
});
