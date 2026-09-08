import type oracledb from "oracledb";
import { getPool } from "./pool.js";

export type Binds = oracledb.BindParameters;

/**
 * A single bound value. Used where a query builds its bind set dynamically,
 * such as a PATCH that only updates the fields it was given.
 */
export type BindValue = string | number | Buffer | Date | null;

/**
 * The interface every repository takes. Because a plain query and a transaction
 * both satisfy it, the same repository function works standalone or as one step
 * inside a larger atomic operation — no duplicated "…WithTransaction" variants.
 */
export interface Queryable {
  many<T>(sql: string, binds?: Binds): Promise<T[]>;
  one<T>(sql: string, binds?: Binds): Promise<T | null>;
  run(sql: string, binds?: Binds): Promise<number>;
}

/** ORACLE_STYLE_COLUMN -> oracleStyleColumn */
function toCamelCase(column: string): string {
  return column
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, chr: string) => chr.toUpperCase());
}

function mapRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    out[toCamelCase(key)] = row[key];
  }
  return out as T;
}

/**
 * Wraps an Oracle driver error so callers can branch on the violated
 * constraint by name instead of string-matching driver messages at call sites.
 */
export class DbError extends Error {
  readonly errorNum: number;
  readonly constraintName?: string;

  constructor(cause: unknown) {
    const err = cause as { message?: string; errorNum?: number };
    super(err.message ?? "Database error");
    this.name = "DbError";
    this.errorNum = err.errorNum ?? -1;
    this.cause = cause;

    // e.g. "unique constraint (RAXTAN.UX_APP_ONE_ACCEPTED) violated"
    const match = /\(([A-Z0-9_$#.]+)\)/i.exec(err.message ?? "");
    if (match?.[1]) {
      const parts = match[1].split(".");
      this.constraintName = (parts[parts.length - 1] ?? "").toUpperCase();
    }
  }

  /** ORA-00001: a UNIQUE constraint or unique index was violated. */
  get isUniqueViolation(): boolean {
    return this.errorNum === 1;
  }

  /** ORA-02290: a CHECK constraint was violated. */
  get isCheckViolation(): boolean {
    return this.errorNum === 2290;
  }

  /** ORA-02291: no matching parent key for a foreign key. */
  get isForeignKeyViolation(): boolean {
    return this.errorNum === 2291;
  }
}

function wrap(error: unknown): never {
  throw new DbError(error);
}

function queryable(
  conn: oracledb.Connection,
  options: { autoCommit: boolean },
): Queryable {
  return {
    async many<T>(sql: string, binds: Binds = {}): Promise<T[]> {
      try {
        const result = await conn.execute<Record<string, unknown>>(sql, binds, {
          autoCommit: false,
        });
        return (result.rows ?? []).map((row) => mapRow<T>(row));
      } catch (error) {
        wrap(error);
      }
    },

    async one<T>(sql: string, binds: Binds = {}): Promise<T | null> {
      const rows = await this.many<T>(sql, binds);
      return rows[0] ?? null;
    },

    async run(sql: string, binds: Binds = {}): Promise<number> {
      try {
        const result = await conn.execute(sql, binds, {
          autoCommit: options.autoCommit,
        });
        return result.rowsAffected ?? 0;
      } catch (error) {
        wrap(error);
      }
    },
  };
}

/**
 * Runs a single statement on a borrowed connection. Writes made this way commit
 * immediately; anything that must be atomic across statements belongs in
 * `withTransaction`.
 */
export const db: Queryable = {
  async many<T>(sql: string, binds: Binds = {}): Promise<T[]> {
    const conn = await getPool().getConnection();
    try {
      return await queryable(conn, { autoCommit: true }).many<T>(sql, binds);
    } finally {
      await conn.close();
    }
  },

  async one<T>(sql: string, binds: Binds = {}): Promise<T | null> {
    const conn = await getPool().getConnection();
    try {
      return await queryable(conn, { autoCommit: true }).one<T>(sql, binds);
    } finally {
      await conn.close();
    }
  },

  async run(sql: string, binds: Binds = {}): Promise<number> {
    const conn = await getPool().getConnection();
    try {
      return await queryable(conn, { autoCommit: true }).run(sql, binds);
    } finally {
      await conn.close();
    }
  },
};

/**
 * Runs `fn` inside a transaction, committing on return and rolling back on
 * throw. Every multi-step marketplace operation — accepting an application,
 * which also rejects the others, opens a commission and moves the posting —
 * goes through here so a half-applied state cannot survive an error.
 */
export async function withTransaction<T>(
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    const result = await fn(queryable(conn, { autoCommit: false }));
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {
      /* the original error is more useful than a rollback failure */
    });
    throw error;
  } finally {
    await conn.close();
  }
}
