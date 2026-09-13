import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../../config.js";

export interface MailMessage {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sending email, behind a port like storage.
 *
 * `none` is a real setting, not a missing one: with no driver there is no way
 * to deliver a verification link, so email verification switches itself off
 * rather than creating accounts that can never be verified. Everything that
 * depends on it asks emailVerificationEnabled().
 *
 * Render's free instances block outbound SMTP, which rules out sending
 * through a Gmail account, so production uses an HTTP API. Brevo was chosen
 * for a free tier that needs no domain: a sender address is verified by
 * clicking a link, which a client without a domain can do.
 */
export interface Mailer {
  readonly name: "none" | "log" | "outbox" | "brevo" | "memory";
  send(message: MailMessage): Promise<void>;
}

const noMailer: Mailer = {
  name: "none",
  async send() {
    throw new Error("No mail driver is configured.");
  },
};

/** Development: prints the message, link included, to the API's console. */
const logMailer: Mailer = {
  name: "log",
  async send(message) {
    console.log(`\n--- email to ${message.to}: ${message.subject}\n${message.text}\n---\n`);
  },
};

/** Where the outbox driver writes. Ignored by git. */
export const OUTBOX_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.outbox");

/**
 * The browser tests: each message becomes a JSON file the test reads the link
 * from, which is the part a real inbox would otherwise make untestable.
 */
const outboxMailer: Mailer = {
  name: "outbox",
  async send(message) {
    await mkdir(OUTBOX_DIR, { recursive: true });
    const safe = message.to.replace(/[^a-z0-9@._-]/gi, "_");
    await writeFile(
      join(OUTBOX_DIR, `${Date.now()}-${safe}.json`),
      JSON.stringify(message, null, 2),
    );
  },
};

export function createBrevoMailer(
  fetchImpl: typeof fetch = fetch,
  settings: { apiKey?: string; fromEmail?: string; fromName: string } = config.mail.brevo,
): Mailer {
  const { apiKey, fromEmail, fromName } = settings;
  if (!apiKey || !fromEmail) {
    throw new Error("Brevo selected but BREVO_API_KEY or MAIL_FROM_EMAIL is missing.");
  }

  return {
    name: "brevo",
    async send(message) {
      const response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email: message.to, ...(message.toName ? { name: message.toName } : {}) }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
      });
      if (!response.ok) {
        // The status and Brevo's own reason, never the request: it carries the
        // key in a header and the recipient's address in the body.
        const detail = await response.text().catch(() => "");
        throw new Error(`Brevo refused the message (${response.status}): ${detail.slice(0, 200)}`);
      }
    },
  };
}

let instance: Mailer | undefined;

export function getMailer(): Mailer {
  if (!instance) {
    switch (config.mail.driver) {
      case "brevo":
        instance = createBrevoMailer();
        break;
      case "log":
        instance = logMailer;
        break;
      case "outbox":
        instance = outboxMailer;
        break;
      default:
        instance = noMailer;
    }
  }
  return instance;
}

/** Tests swap in a mailer that records what it was given. */
export function setMailer(mailer: Mailer | undefined): void {
  instance = mailer;
}

export function emailVerificationEnabled(): boolean {
  return getMailer().name !== "none";
}
