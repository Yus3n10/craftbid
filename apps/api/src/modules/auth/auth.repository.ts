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
