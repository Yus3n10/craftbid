import { db, withTransaction } from "./query.js";
import { getStorage } from "../lib/storage/index.js";
import { config } from "../config.js";

/**
 * Removes accounts whose username begins with a prefix, and everything they
 * own.
 *
 * Written for clearing smoke-test accounts out of a real database, which is
 * why it reports before it acts and does nothing at all without --commit.
 *
 * Deletion has to be ordered by hand. Marketplace history deliberately does
 * not cascade from a user: postings, applications, commissions, reviews and
 * images all reference users without ON DELETE CASCADE, precisely so that
 * removing a person cannot quietly erase the record of a commission the other
 * party was part of. That protection is worth keeping, so this walks the graph
 * in dependency order instead of weakening the schema.
 */

const PREFIX = process.env.PURGE_PREFIX ?? "smoketest_";
const COMMIT = process.argv.includes("--commit");

interface Doomed {
  ids: Buffer[];
  usernames: string[];
}

async function findAccounts(): Promise<Doomed> {
  const rows = await db.many<{ id: Buffer; username: string }>(
    `SELECT id, username FROM users WHERE username LIKE :pattern ORDER BY username`,
    { pattern: `${PREFIX}%` },
  );
  return { ids: rows.map((r) => r.id), usernames: rows.map((r) => r.username) };
}

/** Oracle has no array binding for IN, so the list is expanded into binds. */
function inClause(ids: Buffer[]): { sql: string; binds: Record<string, Buffer> } {
  const binds: Record<string, Buffer> = {};
  const names = ids.map((id, i) => {
    binds[`u${i}`] = id;
    return `:u${i}`;
  });
  return { sql: names.join(", "), binds };
}

async function countRelated(
  ids: Buffer[],
): Promise<{ table: string; count: number }[]> {
  const { sql, binds } = inClause(ids);
  const queries: [string, string][] = [
    ["images", `SELECT COUNT(*) AS c FROM images WHERE owner_id IN (${sql})`],
    ["postings", `SELECT COUNT(*) AS c FROM postings WHERE client_id IN (${sql})`],
    ["artist_posts", `SELECT COUNT(*) AS c FROM artist_posts WHERE artist_id IN (${sql})`],
    ["applications", `SELECT COUNT(*) AS c FROM applications WHERE artist_id IN (${sql})`],
    [
      "commissions",
      `SELECT COUNT(*) AS c FROM commissions WHERE client_id IN (${sql}) OR artist_id IN (${sql})`,
    ],
    [
      "reviews",
      `SELECT COUNT(*) AS c FROM reviews WHERE reviewer_id IN (${sql}) OR reviewee_id IN (${sql})`,
    ],
  ];

  const out: { table: string; count: number }[] = [];
  for (const [table, query] of queries) {
    const row = await db.one<{ c: number }>(query, binds);
    out.push({ table, count: Number(row?.c ?? 0) });
  }
  return out;
}

async function main(): Promise<void> {
  const { initPool } = await import("./pool.js");
  await initPool();

  const { ids, usernames } = await findAccounts();

  console.log(`Database:  ${config.db.connectString}`);
  console.log(`Prefix:    ${PREFIX}`);
  console.log(`Mode:      ${COMMIT ? "COMMIT — this deletes" : "dry run"}\n`);

  if (ids.length === 0) {
    console.log("No matching accounts. Nothing to do.");
    return;
  }

  console.log(`${ids.length} account(s):`);
  for (const name of usernames) console.log(`  ${name}`);

  console.log("\nOwned records:");
  for (const { table, count } of await countRelated(ids)) {
    console.log(`  ${table.padEnd(14)} ${count}`);
  }

  // Collected before deleting: once the rows are gone there is no way to find
  // the objects they pointed at, and orphaned files still count against the
  // storage quota.
  const { sql, binds } = inClause(ids);
  // No quoted alias here. The row mapper lowercases before un-snaking, so a
  // quoted "objectKey" survives Oracle only to arrive as `objectkey`. Selecting
  // the plain column and letting the mapper do the work is the way round.
  const objects = await db.many<{ objectKey: string }>(
    `SELECT object_key FROM images WHERE owner_id IN (${sql})`,
    binds,
  );

  if (!COMMIT) {
    console.log(
      `\n${objects.length} stored image object(s) would also be removed.`,
    );
    console.log("\nDry run. Re-run with --commit to delete.");
    return;
  }

  await withTransaction(async (tx) => {
    // Order matters: children before parents, and reviews before the
    // commissions they cite.
    const steps: [string, string][] = [
      [
        "reviews",
        `DELETE FROM reviews WHERE reviewer_id IN (${sql}) OR reviewee_id IN (${sql})`,
      ],
      [
        "commissions",
        `DELETE FROM commissions WHERE client_id IN (${sql}) OR artist_id IN (${sql})`,
      ],
      ["applications", `DELETE FROM applications WHERE artist_id IN (${sql})`],
      ["postings", `DELETE FROM postings WHERE client_id IN (${sql})`],
      ["artist_posts", `DELETE FROM artist_posts WHERE artist_id IN (${sql})`],
      // Portrait and cover references are ON DELETE SET NULL, so the images go
      // cleanly once nothing else points at them.
      ["images", `DELETE FROM images WHERE owner_id IN (${sql})`],
      // Everything left hanging off a user cascades: profiles, links, tokens,
      // notifications, reports.
      ["users", `DELETE FROM users WHERE id IN (${sql})`],
    ];

    for (const [label, statement] of steps) {
      const rows = await tx.run(statement, binds);
      console.log(`  deleted ${String(rows).padStart(4)}  ${label}`);
    }
  });

  // After the commit, so a storage outage cannot roll back a completed
  // deletion or leave the database disagreeing with the file store.
  const storage = getStorage();
  let removed = 0;
  for (const { objectKey } of objects) {
    try {
      await storage.remove(objectKey);
      removed++;
    } catch (error) {
      console.log(`  could not remove ${objectKey}: ${(error as Error).message}`);
    }
  }
  console.log(`  removed ${removed}/${objects.length} stored objects`);

  console.log("\nDone.");
}

main()
  .then(async () => {
    const { closePool } = await import("./pool.js");
    await closePool();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("Purge failed:", error);
    const { closePool } = await import("./pool.js");
    await closePool();
    process.exit(1);
  });
