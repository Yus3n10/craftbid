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
import { verificationEmail } from "./verification-email.js";

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

/**
 * Creates the account. With email verification on, nobody is signed in yet:
 * a link goes to the address, and following it is what starts the session.
 * With it off, registration signs in straight away, as it always did.
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
  await sessions.storeVerificationToken({
    userId,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + VERIFICATION_HOURS * 3_600_000),
    persistent,
  });
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

  const recent = await sessions.recentVerificationTokens(user.id);
  if (recent.lastHour >= 5) return;
  if (recent.lastSentAt && Date.now() - recent.lastSentAt.getTime() < 60_000) return;

  try {
    await sendVerification(user.id, user.email, user.displayName, false);
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
