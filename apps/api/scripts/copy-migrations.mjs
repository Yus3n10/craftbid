import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies the migration SQL into the build output.
 *
 * tsc only emits JavaScript, so without this `dist/db/migrations` does not
 * exist and the built migration CLI fails with ENOENT.
 *
 * Written in Node rather than as a shell `cp` so it works on Windows too.
 */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(packageRoot, "src", "db", "migrations");
const to = join(packageRoot, "dist", "db", "migrations");

if (!existsSync(from)) {
  throw new Error(`No migrations directory at ${from}`);
}

mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });

console.log(`Copied migrations to ${to}`);
