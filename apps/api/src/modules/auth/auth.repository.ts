import { bufToUuid, newId, uuidToBuf } from "../../db/ids.js";
import { db, type Queryable } from "../../db/query.js";

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  /** "Keep me logged in" was ticked when this session began. */
  persistent: boolean;
}

interface RefreshTokenRow {
  id: Buffer;
  userId: Buffer;
  expiresAt: Date;
  revokedAt: Date | null;
  persistent: number;
}

export async function storeRefreshToken(
  input: { userId: string; tokenHash: string; expiresAt: Date; persistent: boolean },
  q: Queryable = db,
): Promise<string> {
  const id = newId();
  await q.run(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, persistent)
     VALUES (:id, :userId, :tokenHash, :expiresAt, :persistent)`,
    {
      id: uuidToBuf(id),
      userId: uuidToBuf(input.userId),
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      persistent: input.persistent ? 1 : 0,
    },
  );
  return id;
}

/** Looks up a token by hash. The raw token is never stored, so never queried. */
export async function findByTokenHash(
  tokenHash: string,
  q: Queryable = db,
): Promise<RefreshTokenRecord | null> {
  const row = await q.one<RefreshTokenRow>(
    `SELECT id, user_id, expires_at, revoked_at, persistent
       FROM refresh_tokens
      WHERE token_hash = :tokenHash`,
    { tokenHash },
  );
  if (!row) return null;
  return {
    id: bufToUuid(row.id)!,
    userId: bufToUuid(row.userId)!,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    persistent: row.persistent === 1,
  };
}

export async function revokeToken(id: string, q: Queryable = db): Promise<void> {
  await q.run(
    `UPDATE refresh_tokens
        SET revoked_at = SYSTIMESTAMP
      WHERE id = :id AND revoked_at IS NULL`,
    { id: uuidToBuf(id) },
  );
}

/** Signs the user out everywhere, used on password change or suspected theft. */
export async function revokeAllForUser(
  userId: string,
  q: Queryable = db,
): Promise<void> {
  await q.run(
    `UPDATE refresh_tokens
        SET revoked_at = SYSTIMESTAMP
      WHERE user_id = :userId AND revoked_at IS NULL`,
    { userId: uuidToBuf(userId) },
  );
}

/**
 * Removes tokens that expired more than a week ago. Nothing calls this on a
 * schedule yet; it exists so the table has a defined cleanup path rather than
 * growing without bound.
 */
export async function deleteExpired(q: Queryable = db): Promise<number> {
  return q.run(
    `DELETE FROM refresh_tokens WHERE expires_at < SYSTIMESTAMP - INTERVAL '7' DAY`,
  );
}

export interface VerificationTokenRecord {
  id: string;
  userId: string;
  persistent: boolean;
  expiresAt: Date;
  usedAt: Date | null;
}

export async function storeVerificationToken(
  input: { userId: string; tokenHash: string; expiresAt: Date; persistent: boolean },
  q: Queryable = db,
): Promise<void> {
  await q.run(
    `INSERT INTO email_verification_tokens (id, user_id, token_hash, persistent, expires_at)
     VALUES (:id, :userId, :tokenHash, :persistent, :expiresAt)`,
    {
      id: uuidToBuf(newId()),
      userId: uuidToBuf(input.userId),
      tokenHash: input.tokenHash,
      persistent: input.persistent ? 1 : 0,
      expiresAt: input.expiresAt,
    },
  );
}

export async function findVerificationToken(
  tokenHash: string,
  q: Queryable = db,
): Promise<VerificationTokenRecord | null> {
  const row = await q.one<{
    id: Buffer;
    userId: Buffer;
    persistent: number;
    expiresAt: Date;
    usedAt: Date | null;
  }>(
    `SELECT id, user_id, persistent, expires_at, used_at
       FROM email_verification_tokens
      WHERE token_hash = :tokenHash`,
    { tokenHash },
  );
  if (!row) return null;
  return {
    id: bufToUuid(row.id)!,
    userId: bufToUuid(row.userId)!,
    persistent: row.persistent === 1,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
  };
}

/**
 * Spends one link, and only if it is still unspent. Returns whether this call
 * spent it, so two clicks racing on the same link cannot both sign someone in.
 */
export async function spendVerificationToken(id: string, tx: Queryable): Promise<boolean> {
  const changed = await tx.run(
    `UPDATE email_verification_tokens SET used_at = SYSTIMESTAMP
      WHERE id = :id AND used_at IS NULL`,
    { id: uuidToBuf(id) },
  );
  return changed === 1;
}

/** Once an address is verified, every other link sent to it stops working. */
export async function spendAllVerificationTokens(userId: string, tx: Queryable): Promise<void> {
  await tx.run(
    `UPDATE email_verification_tokens SET used_at = SYSTIMESTAMP
      WHERE user_id = :userId AND used_at IS NULL`,
    { userId: uuidToBuf(userId) },
  );
}

/** Links sent to this person recently, and when the last one went. */
export async function recentVerificationTokens(
  userId: string,
  q: Queryable = db,
): Promise<{ lastHour: number; lastSentAt: Date | null }> {
  const row = await q.one<{ cnt: number; lastSentAt: Date | null }>(
    `SELECT COUNT(*) AS cnt, MAX(created_at) AS last_sent_at
       FROM email_verification_tokens
      WHERE user_id = :userId AND created_at > SYSTIMESTAMP - INTERVAL '1' HOUR`,
    { userId: uuidToBuf(userId) },
  );
  return { lastHour: Number(row?.cnt ?? 0), lastSentAt: row?.lastSentAt ?? null };
}

export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export async function storePasswordResetToken(
  input: { userId: string; tokenHash: string; expiresAt: Date },
  q: Queryable = db,
): Promise<void> {
  await q.run(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES (:id, :userId, :tokenHash, :expiresAt)`,
    {
      id: uuidToBuf(newId()),
      userId: uuidToBuf(input.userId),
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    },
  );
}

export async function findPasswordResetToken(
  tokenHash: string,
  q: Queryable = db,
): Promise<PasswordResetTokenRecord | null> {
  const row = await q.one<{ id: Buffer; userId: Buffer; expiresAt: Date; usedAt: Date | null }>(
    `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
      WHERE token_hash = :tokenHash`,
    { tokenHash },
  );
  if (!row) return null;
  return {
    id: bufToUuid(row.id)!,
    userId: bufToUuid(row.userId)!,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
  };
}

/**
 * Spends one reset link, and only if it is still unspent, so two submissions
 * racing on the same link cannot both set a password.
 */
export async function spendPasswordResetToken(id: string, tx: Queryable): Promise<boolean> {
  const changed = await tx.run(
    `UPDATE password_reset_tokens SET used_at = SYSTIMESTAMP
      WHERE id = :id AND used_at IS NULL`,
    { id: uuidToBuf(id) },
  );
  return changed === 1;
}

/** After a reset, or when an account closes, every other reset link stops working. */
export async function spendAllPasswordResetTokens(userId: string, tx: Queryable): Promise<void> {
  await tx.run(
    `UPDATE password_reset_tokens SET used_at = SYSTIMESTAMP
      WHERE user_id = :userId AND used_at IS NULL`,
    { userId: uuidToBuf(userId) },
  );
}

/** Reset links sent to this person recently, and when the last one went. */
export async function recentPasswordResetTokens(
  userId: string,
  q: Queryable = db,
): Promise<{ lastHour: number; lastSentAt: Date | null }> {
  const row = await q.one<{ cnt: number; lastSentAt: Date | null }>(
    `SELECT COUNT(*) AS cnt, MAX(created_at) AS last_sent_at
       FROM password_reset_tokens
      WHERE user_id = :userId AND created_at > SYSTIMESTAMP - INTERVAL '1' HOUR`,
    { userId: uuidToBuf(userId) },
  );
  return { lastHour: Number(row?.cnt ?? 0), lastSentAt: row?.lastSentAt ?? null };
}
