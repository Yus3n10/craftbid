import type { LoginInput, RegisterInput, UserRole, VerificationSentDto } from "@craftbid/shared";
import { config } from "../../config.js";
import { uuidToBuf } from "../../db/ids.js";
import { DbError, withTransaction } from "../../db/query.js";
import { AppError, badRequest, conflict, unauthorized } from "../../lib/errors.js";
import { emailVerificationEnabled, getMailer } from "../../lib/mail/index.js";
import { hashPassword, verifyPassword, wastePasswordTime } from "../../lib/password.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "../../lib/tokens.js";
import * as users from "../users/users.repository.js";
import * as sessions from "./auth.repository.js";
import { passwordResetEmail, verificationEmail } from "./verification-email.js";

export interface SessionTokens {
  userId: string;
  role: UserRole;
  accessToken: string;
  refreshToken: string;
  /** Whether the cookies carrying these should outlive the browser. */
  persistent: boolean;
}

async function issueTokens(
  userId: string,
  role: UserRole,
  persistent: boolean,
): Promise<SessionTokens> {
  const refreshToken = generateRefreshToken();
  await sessions.storeRefreshToken({
    userId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshTokenExpiry(persistent),
    persistent,
  });
  return {
    userId,
    role,
    accessToken: await signAccessToken({ sub: userId, role }),
    refreshToken,
    persistent,
  };
}

/** A new session for an account whose details just changed. */
export function startSession(userId: string, role: UserRole, persistent: boolean): Promise<SessionTokens> {
  return issueTokens(userId, role, persistent);
}

/**
 * Creates the account. With email verification on, nobody is signed in yet:
 * a link goes to the address, and following it is what starts the session.
 * With it off, registration signs in straight away.
 */
export async function register(
  input: RegisterInput,
): Promise<SessionTokens | VerificationSentDto> {
  const passwordHash = await hashPassword(input.password);

  let userId: string;
  try {
    userId = await withTransaction((tx) =>
      users.createUser(
        {
          email: input.email,
          username: input.username,
          passwordHash,
          role: input.role,
          displayName: input.displayName,
        },
        tx,
      ),
    );
  } catch (error) {
    // Letting the unique index decide, rather than checking first, avoids a
    // race where two simultaneous registrations both pass the check.
    if (error instanceof DbError && error.isUniqueViolation) {
      if (error.constraintName === "UQ_USERS_EMAIL") {
        throw conflict("That email is already registered.", {
          email: "That email is already registered.",
        });
      }
      if (error.constraintName === "UQ_USERS_USERNAME") {
        throw conflict("That username is taken.", {
          username: "That username is taken.",
        });
      }
    }
    throw error;
  }

  if (emailVerificationEnabled()) {
    try {
      await sendVerification(userId, input.email, input.displayName, input.remember === true);
    } catch (error) {
      // The account exists either way. A failed send is recoverable from the
      // page that follows, which offers another link, so it must not turn
      // into an error that invites registering the same address again.
      console.error("Verification email failed to send", error);
    }
    return { status: "verification_sent", email: input.email };
  }

  return issueTokens(userId, input.role, input.remember === true);
}

const VERIFICATION_HOURS = 24;

async function sendVerification(
  userId: string,
  email: string,
  displayName: string,
  persistent: boolean,
): Promise<void> {
  const token = generateRefreshToken();
  await storeVerification(userId, token, persistent);
  await mailVerification(email, displayName, token);
}

function storeVerification(
  userId: string,
  token: string,
  persistent: boolean,
  q?: Parameters<typeof sessions.storeVerificationToken>[1],
): Promise<void> {
  return sessions.storeVerificationToken(
    {
      userId,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + VERIFICATION_HOURS * 3_600_000),
      persistent,
    },
    q,
  );
}

async function mailVerification(email: string, displayName: string, token: string): Promise<void> {
  await getMailer().send(
    verificationEmail({
      to: email,
      displayName,
      link: `${config.mail.publicWebUrl}/verify-email?token=${token}`,
      hoursValid: VERIFICATION_HOURS,
    }),
  );
}

/**
 * Follows a verification link: proves the address, and signs that person in.
 *
 * Signing in here is what "takes them to their new account" means. Holding
 * the link is proof of the inbox, which is the same proof a password reset
 * relies on, and the link is single-use and short-lived.
 */
export async function verifyEmail(token: string): Promise<SessionTokens> {
  const record = await sessions.findVerificationToken(hashRefreshToken(token));
  if (!record) {
    throw new AppError(400, "link_invalid", "This link is not valid. Ask for a new one below.");
  }

  const user = await users.findById(record.userId);
  if (!user || user.status !== "active") {
    throw unauthorized("This account is not active.");
  }

  if (record.usedAt) {
    throw new AppError(
      409,
      user.emailVerifiedAt ? "already_verified" : "link_used",
      user.emailVerifiedAt
        ? "Your email is already confirmed. Sign in to continue."
        : "This link was already used. Ask for a new one below.",
    );
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new AppError(410, "link_expired", "This link has expired. Ask for a new one below.");
  }

  const spent = await withTransaction(async (tx) => {
    if (!(await sessions.spendVerificationToken(record.id, tx))) return false;
    await users.markEmailVerified(user.id, tx);
    await sessions.spendAllVerificationTokens(user.id, tx);
    return true;
  });
  if (!spent) {
    throw new AppError(409, "link_used", "This link was already used. Sign in to continue.");
  }

  return issueTokens(user.id, user.role, record.persistent);
}

/**
 * Sends another link. Signed in, it goes to that account's address; signed
 * out, to the address given.
 *
 * Always answers the same way whether or not the address has an account, is
 * already verified, or has asked too often, so this cannot be used to find out
 * who is registered. The limits (one a minute, five an hour per account) are
 * enforced silently for the same reason.
 */
export async function resendVerification(
  target: { userId: string } | { email: string },
): Promise<void> {
  if (!emailVerificationEnabled()) return;

  const user =
    "userId" in target ? await users.findById(target.userId) : await users.findByEmail(target.email);
  if (!user || user.status !== "active" || user.emailVerifiedAt) return;

  const token = generateRefreshToken();
  const claimed = await withTransaction(async (tx) => {
    // The same lock as password reset: without it, requests at the same moment
    // all pass the limit check and each sends a link.
    await tx.run(`SELECT id FROM users WHERE id = :id FOR UPDATE`, { id: uuidToBuf(user.id) });
    const recent = await sessions.recentVerificationTokens(user.id, tx);
    if (recent.lastHour >= 5) return false;
    if (recent.lastSentAt && Date.now() - recent.lastSentAt.getTime() < 60_000) return false;
    await storeVerification(user.id, token, false, tx);
    return true;
  });
  if (!claimed) return;

  try {
    await mailVerification(user.email, user.displayName, token);
  } catch (error) {
    console.error("Verification email failed to send", error);
  }
}

/** Whether an account may do the things that need a proved address. */
export async function isVerified(userId: string): Promise<boolean> {
  if (!emailVerificationEnabled()) return true;
  const user = await users.findById(userId);
  return Boolean(user?.emailVerifiedAt);
}

export async function login(input: LoginInput): Promise<SessionTokens> {
  const user = await users.findByEmail(input.email);

  if (!user) {
    // Spend comparable time on a missing account so response latency does not
    // reveal which addresses are registered.
    await wastePasswordTime(input.password);
    throw unauthorized("Email or password is incorrect.");
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw unauthorized("Email or password is incorrect.");
  }

  // Said only after the right password, so it reveals nothing to a stranger.
  if (user.status === "suspended") {
    throw new AppError(
      403,
      "account_suspended",
      "This account is suspended for breaking Craftbid's rules. If you think this is a mistake, contact Craftbid.",
    );
  }
  if (user.status !== "active") {
    throw unauthorized("This account is not active.");
  }

  return issueTokens(user.id, user.role, input.remember === true);
}

/**
 * Exchanges a refresh token for a new pair, revoking the one presented.
 * Rotating on every use means a stolen token stops working as soon as the
 * legitimate client refreshes.
 */
export async function refresh(token: string | undefined): Promise<SessionTokens> {
  if (!token) throw unauthorized("Session expired. Please sign in again.");

  const record = await sessions.findByTokenHash(hashRefreshToken(token));
  if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
    throw unauthorized("Session expired. Please sign in again.");
  }

  const user = await users.findById(record.userId);
  if (!user || user.status !== "active") {
    throw unauthorized("This account is not active.");
  }

  await sessions.revokeToken(record.id);
  // The replacement inherits the original choice. Taking it from the request
  // instead would let any refresh quietly turn a session that was meant to end
  // with the browser into a month-long one.
  return issueTokens(user.id, user.role, record.persistent);
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  const record = await sessions.findByTokenHash(hashRefreshToken(token));
  if (record) await sessions.revokeToken(record.id);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await users.findById(userId);
  if (!user) throw unauthorized();

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw badRequest("Your current password is incorrect.", {
      currentPassword: "Your current password is incorrect.",
    });
  }

  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (tx) => {
    await tx.run(
      `UPDATE users SET password_hash = :passwordHash, updated_at = SYSTIMESTAMP
        WHERE id = :id`,
      { passwordHash, id: uuidToBuf(userId) },
    );
    // Every other session is invalidated: a password change is the action
    // someone takes when they think an account is compromised.
    await sessions.revokeAllForUser(userId, tx);
  });
}

const RESET_MINUTES = 60;

/**
 * Emails a password reset link.
 *
 * Answers nothing either way: the route replies before this runs, so neither
 * the response nor its timing says whether an address has an account. The
 * limits (one a minute, three an hour per account) are enforced silently for
 * the same reason, and keep this from being used to flood someone's inbox.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!emailVerificationEnabled()) return;

  const user = await users.findByEmail(email);
  if (!user || user.status !== "active") return;

  const token = generateRefreshToken();
  const claimed = await withTransaction(async (tx) => {
    // Locking the account row makes the limit check and the new link one
    // step. Two requests at the same moment otherwise both see no recent link
    // and both send one.
    await tx.run(`SELECT id FROM users WHERE id = :id FOR UPDATE`, { id: uuidToBuf(user.id) });
    const recent = await sessions.recentPasswordResetTokens(user.id, tx);
    if (recent.lastHour >= 3) return false;
    if (recent.lastSentAt && Date.now() - recent.lastSentAt.getTime() < 60_000) return false;
    await sessions.storePasswordResetToken(
      {
        userId: user.id,
        tokenHash: hashRefreshToken(token),
        expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000),
      },
      tx,
    );
    return true;
  });
  if (!claimed) return;
  await getMailer().send(
    passwordResetEmail({
      to: user.email,
      displayName: user.displayName,
      link: `${config.mail.publicWebUrl}/reset-password?token=${token}`,
      minutesValid: RESET_MINUTES,
    }),
  );
}

/**
 * Sets a new password from a reset link.
 *
 * Every session is revoked, since a reset is often what someone does when they
 * think another person is in their account, and nobody is signed in: the
 * person signs in with the new password, which also proves they typed it as
 * they meant to. Holding the link proves the inbox, so an unconfirmed email
 * becomes confirmed.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await sessions.findPasswordResetToken(hashRefreshToken(token));
  if (!record) {
    throw new AppError(400, "link_invalid", "This link is not valid. Ask for a new one.");
  }
  if (record.usedAt) {
    throw new AppError(409, "link_used", "This link was already used. Ask for a new one if you still need it.");
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new AppError(410, "link_expired", "This link has expired. Ask for a new one.");
  }

  const user = await users.findById(record.userId);
  if (!user || user.status !== "active") {
    throw new AppError(400, "link_invalid", "This link is not valid. Ask for a new one.");
  }

  const passwordHash = await hashPassword(newPassword);
  const spent = await withTransaction(async (tx) => {
    if (!(await sessions.spendPasswordResetToken(record.id, tx))) return false;
    await tx.run(
      `UPDATE users SET password_hash = :passwordHash, updated_at = SYSTIMESTAMP WHERE id = :id`,
      { passwordHash, id: uuidToBuf(user.id) },
    );
    await sessions.spendAllPasswordResetTokens(user.id, tx);
    await sessions.revokeAllForUser(user.id, tx);
    await users.markEmailVerified(user.id, tx);
    return true;
  });
  if (!spent) {
    throw new AppError(409, "link_used", "This link was already used. Ask for a new one if you still need it.");
  }
}
