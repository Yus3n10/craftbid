import { getMailer, type MailMessage } from "./index.js";
import { recordMail, type MailKind } from "./mail-log.repository.js";

/**
 * The only way this codebase sends email.
 *
 * Every send is recorded with what became of it, so a sender that starts
 * refusing is a question the mail CLI answers rather than something a user
 * reports days later. Going through `getMailer().send` directly skips that
 * record, which is the situation this exists to prevent.
 *
 * The record is a side effect and never changes the outcome: a send that
 * worked stays worked even if the row cannot be written, and a send that
 * failed still throws for the caller to handle.
 */
export async function sendMail(kind: MailKind, message: MailMessage): Promise<void> {
  const mailer = getMailer();
  try {
    await mailer.send(message);
  } catch (error) {
    await record(kind, message, mailer.name, error);
    throw error;
  }
  await record(kind, message, mailer.name, undefined);
}

async function record(
  kind: MailKind,
  message: MailMessage,
  driver: string,
  error: unknown,
): Promise<void> {
  try {
    await recordMail({
      kind,
      recipient: message.to,
      subject: message.subject,
      status: error ? "failed" : "sent",
      error: error ? String(error instanceof Error ? error.message : error) : undefined,
      driver,
    });
  } catch (logError) {
    console.error("Recording a mail attempt failed", logError);
  }
}
