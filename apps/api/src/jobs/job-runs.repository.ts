import { DbError, db, type Queryable } from "../db/query.js";

/**
 * Claims one run of a scheduled job by inserting its key. Returns false when
 * the key is already taken: another tick, or an earlier process before a
 * restart, has done this run.
 */
export async function claimRun(name: string, runKey: string, ranAt: Date, q: Queryable = db): Promise<boolean> {
  try {
    await q.run(`INSERT INTO job_runs (name, run_key, ran_at) VALUES (:name, :runKey, :ranAt)`, { name, runKey, ranAt });
    return true;
  } catch (error) {
    if (error instanceof DbError && error.isUniqueViolation) return false;
    throw error;
  }
}

/** Gives a claimed run back, so the next tick tries it again. */
export async function releaseRun(name: string, runKey: string, q: Queryable = db): Promise<void> {
  await q.run(`DELETE FROM job_runs WHERE name = :name AND run_key = :runKey`, { name, runKey });
}

/** When this job last ran, or null if it never has. */
export async function lastRunAt(name: string, q: Queryable = db): Promise<Date | null> {
  const row = await q.one<{ ranAt: Date | null }>(`SELECT MAX(ran_at) AS ran_at FROM job_runs WHERE name = :name`, { name });
  return row?.ranAt ?? null;
}
