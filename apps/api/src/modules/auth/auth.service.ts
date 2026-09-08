import type { LoginInput, RegisterInput, UserRole } from "@raxtan/shared";
import { uuidToBuf } from "../../db/ids.js";
import { DbError, withTransaction } from "../../db/query.js";
import { badRequest, conflict, unauthorized } from "../../lib/errors.js";
import { hashPassword, verifyPassword, wastePasswordTime } from "../../lib/password.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "../../lib/tokens.js";
import * as users from "../users/users.repository.js";
import * as sessions from "./auth.repository.js";

export interface SessionTokens {
  userId: string;
  role: UserRole;
  accessToken: string;
  refreshToken: string;
}

async function issueTokens(userId: string, role: UserRole): Promise<SessionTokens> {
  const refreshToken = generateRefreshToken();
  await sessions.storeRefreshToken({
    userId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshTokenExpiry(),
  });
  return {
    userId,
    role,
    accessToken: await signAccessToken({ sub: userId, role }),
    refreshToken,
  };
}

export async function register(input: RegisterInput): Promise<SessionTokens> {
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

  return issueTokens(userId, input.role);
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

  return issueTokens(user.id, user.role);
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
  return issueTokens(user.id, user.role);
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
