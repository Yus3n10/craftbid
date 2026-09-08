/**
 * Migration CLI.
 *
 *   pnpm db:migrate          apply pending migrations
 *   pnpm --filter @raxtan/api migrate:status
 *   pnpm --filter @raxtan/api migrate:reset   drop everything (local only)
 */

import { closePool, initPool } from "./pool.js";
import { migrationStatus, resetSchema, runMigrations } from "./migrate.js";

const command = process.argv[2] ?? "up";

async function main(): Promise<void> {
  await initPool();

  switch (command) {
    case "up": {
      console.log("Applying migrations...");
      const result = await runMigrations();
      if (result.applied.length === 0) {
        console.log(`Nothing to do. ${result.skipped} migration(s) already applied.`);
      } else {
        console.log(
          `Applied ${result.applied.length} migration(s); ${result.skipped} already up to date.`,
        );
      }
      break;
    }

    case "status": {
      const rows = await migrationStatus();
      console.log("\n version  applied  name");
      console.log(" -------  -------  ----------------------------------");
      for (const row of rows) {
        console.log(
          ` ${String(row.version).padStart(7)}  ${row.applied ? "  yes  " : "   no  "}  ${row.name}`,
        );
      }
      console.log();
      break;
    }

    case "reset": {
      console.log("Dropping all tables...");
      await resetSchema();
      console.log("Re-applying migrations...");
      await runMigrations();
      console.log("Done.");
      break;
    }

    default:
      console.error(`Unknown command "${command}". Use: up | status | reset`);
      process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("\nMigration failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
