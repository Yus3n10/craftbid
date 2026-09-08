process.env.NODE_ENV = "test";

/**
 * Applies any pending migrations once before the suite runs, so a fresh clone
 * can go from `docker compose up` straight to `pnpm test`.
 */
export async function setup(): Promise<void> {
  const { initPool, closePool } = await import("../db/pool.js");
  const { runMigrations } = await import("../db/migrate.js");

  await initPool();
  await runMigrations(() => {});
  await closePool();
}
