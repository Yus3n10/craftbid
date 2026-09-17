import type { MailMessage } from "../../lib/mail/index.js";

/** Escapes text for the HTML body. A display name is user input. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The verification email. Plain on purpose: a short message with one link
 * reads as legitimate and survives spam filters better than a designed one,
 * and a text part is included for mail apps that show no HTML.
 */
export function verificationEmail(input: {
  to: string;
  displayName: string;
  link: string;
  hoursValid: number;
}): MailMessage {
  const name = input.displayName.trim() || "there";
  const text = [
    `Hi ${name},`,
    "",
    "Confirm your email to finish setting up your Craftbid account:",
    input.link,
    "",
    `The link works once and expires in ${input.hoursValid} hours.`,
    "If you did not create a Craftbid account, you can ignore this email.",
    "",
    "Craftbid",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f4ee;font-family:Arial,Helvetica,sans-serif;color:#1a1f1d">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #ded5c4;border-radius:10px">
      <tr><td style="padding:28px">
        <p style="margin:0 0 16px;font-size:16px">Hi ${escapeHtml(name)},</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.5">Confirm your email to finish setting up your Craftbid account.</p>
        <p style="margin:0 0 24px"><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#1f3a4d;color:#fffdf8;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">Confirm my email</a></p>
        <p style="margin:0 0 8px;font-size:13px;color:#4a5450;line-height:1.5">The link works once and expires in ${input.hoursValid} hours. If the button does not work, copy this into your browser:</p>
        <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${escapeHtml(input.link)}" style="color:#1f3a4d">${escapeHtml(input.link)}</a></p>
        <p style="margin:0;font-size:13px;color:#68726d">If you did not create a Craftbid account, you can ignore this email.</p>
      </td></tr>
    </table>
  </body>
</html>`;

  return {
    to: input.to,
    toName: input.displayName,
    subject: "Confirm your email for Craftbid",
    text,
    html,
  };
}

/** The password reset email. Same plain shape as the verification email. */
/**
 * Sent instead of a verification link when someone signs up with an address
 * that already has a confirmed account. The sign-up page says the same thing
 * either way, so only the inbox owner learns the account exists.
 */
export function accountExistsEmail(input: {
  to: string;
  displayName: string;
  signInLink: string;
  resetLink: string;
}): MailMessage {
  const name = input.displayName.trim() || "there";
  const text = [
    `Hi ${name},`,
    "",
    "Someone tried to create a new Craftbid account with this email, but you already have one.",
    "Sign in here:",
    input.signInLink,
    "",
    "Forgot your password? Choose a new one here:",
    input.resetLink,
    "",
    "If this was not you, ignore this email. Nothing about your account has changed.",
    "",
    "Craftbid",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f4ee;font-family:Arial,Helvetica,sans-serif;color:#1a1f1d">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #ded5c4;border-radius:10px">
      <tr><td style="padding:28px">
        <p style="margin:0 0 16px;font-size:16px">Hi ${escapeHtml(name)},</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.5">Someone tried to create a new Craftbid account with this email, but you already have one.</p>
        <p style="margin:0 0 24px"><a href="${escapeHtml(input.signInLink)}" style="display:inline-block;background:#1f3a4d;color:#fffdf8;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">Sign in</a></p>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.5">Forgot your password? <a href="${escapeHtml(input.resetLink)}" style="color:#1f3a4d">Choose a new one</a>.</p>
        <p style="margin:0;font-size:13px;color:#68726d">If this was not you, ignore this email. Nothing about your account has changed.</p>
      </td></tr>
    </table>
  </body>
</html>`;

  return {
    to: input.to,
    toName: input.displayName,
    subject: "You already have a Craftbid account",
    text,
    html,
  };
}

export function passwordResetEmail(input: {
  to: string;
  displayName: string;
  link: string;
  minutesValid: number;
}): MailMessage {
  const name = input.displayName.trim() || "there";
  const text = [
    `Hi ${name},`,
    "",
    "Someone asked to reset the password for your Craftbid account. To choose a new one, open:",
    input.link,
    "",
    `The link works once and expires in ${input.minutesValid} minutes.`,
    "If you did not ask for this, ignore this email. Your password stays the same.",
    "",
    "Craftbid",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f4ee;font-family:Arial,Helvetica,sans-serif;color:#1a1f1d">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #ded5c4;border-radius:10px">
      <tr><td style="padding:28px">
        <p style="margin:0 0 16px;font-size:16px">Hi ${escapeHtml(name)},</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.5">Someone asked to reset the password for your Craftbid account.</p>
        <p style="margin:0 0 24px"><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#1f3a4d;color:#fffdf8;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">Choose a new password</a></p>
        <p style="margin:0 0 8px;font-size:13px;color:#4a5450;line-height:1.5">The link works once and expires in ${input.minutesValid} minutes. If the button does not work, copy this into your browser:</p>
        <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${escapeHtml(input.link)}" style="color:#1f3a4d">${escapeHtml(input.link)}</a></p>
        <p style="margin:0;font-size:13px;color:#68726d">If you did not ask for this, ignore this email. Your password stays the same.</p>
      </td></tr>
    </table>
  </body>
</html>`;

  return {
    to: input.to,
    toName: input.displayName,
    subject: "Reset your Craftbid password",
    text,
    html,
  };
}
