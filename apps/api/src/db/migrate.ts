import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { db, withTransaction } from "./query.js";

/**
 * A minimal forward-only migration runner.
 *
 * Flyway and Liquibase are the usual answer, but both require a JVM and there
 * is no Java on the target machine — and adding one to the deploy image to run
 * a dozen DDL files would be a poor trade.
 *
 * Every statement is plain SQL that also parses on Oracle 19c, not just 23ai.
 * The production Autonomous Database version is not known yet (Always Free ADB
 * can be provisioned as either), so nothing here uses 23ai-only syntax:
 * no `CREATE TABLE IF NOT EXISTS`, and no native `BOOLEAN` — flags are
 * `NUMBER(1)` constrained to 0 or 1.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

interface MigrationFile {
  version: number;
  name: string;
  fileName: string;
  statements: string[];
}

/**
 * Splits a file into individual statements. Oracle executes exactly one
 * statement per round trip, so a multi-statement file must be split first.
 * Migrations here are pure DDL/DML; if a PL/SQL block is ever needed, it will
 * need a `/` terminator and this splitter will need to understand it.
 */
function splitStatements(sql: string): string[] {
  const withoutComments = sql.replace(/^\s*--.*$/gm, "");
  return withoutComments
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export function loadMigrations(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  return files.map((fileName) => {
    const match = /^(\d+)[-_](.+)\.sql$/.exec(fileName);
    if (!match?.[1] || !match[2]) {
      throw new Error(
        `Migration "${fileName}" must be named like 001-description.sql`,
      );
    }
    return {
      version: Number(match[1]),
      name: match[2],
      fileName,
      statements: splitStatements(readFileSync(join(MIGRATIONS_DIR, fileName), "utf8")),
    };
  });
}

async function ensureMigrationTable(): Promise<void> {
  try {
    await db.run(`
      CREATE TABLE schema_migrations (
        version    NUMBER(6)      NOT NULL,
        name       VARCHAR2(200)  NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT pk_schema_migrations PRIMARY KEY (version)
      )
    `);
  } catch (error) {
    // ORA-00955: name is already used by an existing object. Using the error
    // rather than `IF NOT EXISTS` keeps this working on Oracle 19c.
    const errorNum = (error as { errorNum?: number }).errorNum;
    if (errorNum !== 955) throw error;
  }
}

export async function appliedVersions(): Promise<Set<number>> {
  await ensureMigrationTable();
  const rows = await db.many<{ version: number }>(
    `SELECT version FROM schema_migrations ORDER BY version`,
  );
  return new Set(rows.map((row) => row.version));
}

export interface MigrateResult {
  applied: string[];
  skipped: number;
}

export async function runMigrations(
  log: (message: string) => void = console.log,
): Promise<MigrateResult> {
  const applied = await appliedVersions();
  const migrations = loadMigrations();
  const result: MigrateResult = { applied: [], skipped: 0 };

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      result.skipped += 1;
      continue;
    }

    log(`  applying ${migration.fileName} (${migration.statements.length} statements)`);

    // DDL in Oracle commits implicitly, so a failure part-way through a file
    // cannot be rolled back. Recording the version in the same transaction as
    // the final statement at least guarantees a failed file is never marked
    // applied, so a re-run is required and the failure is visible.
    await withTransaction(async (tx) => {
      for (const statement of migration.statements) {
        await tx.run(statement);
      }
      await tx.run(
        `INSERT INTO schema_migrations (version, name) VALUES (:version, :name)`,
        { version: migration.version, name: migration.name },
      );
    });

    result.applied.push(migration.fileName);
  }

  return result;
}

export async function migrationStatus(): Promise<
  { version: number; name: string; applied: boolean }[]
> {
  const applied = await appliedVersions();
  return loadMigrations().map((migration) => ({
    version: migration.version,
    name: migration.name,
    applied: applied.has(migration.version),
  }));
}

/**
 * Drops every table in the schema. Development convenience only — it refuses to
 * run against production, because "reset the database" is not a mistake that
 * should be recoverable only from a backup.
 */
export async function resetSchema(
  log: (message: string) => void = console.log,
): Promise<void> {
  if (config.isProduction) {
    throw new Error("resetSchema() is disabled when NODE_ENV=production.");
  }
  if (config.db.walletDir) {
    throw new Error(
      "resetSchema() is disabled while ORACLE_WALLET_DIR is set: that points at a cloud database, not the local container.",
    );
  }

  const tables = await db.many<{ tableName: string }>(
    `SELECT table_name FROM user_tables`,
  );

  for (const { tableName } of tables) {
    log(`  dropping ${tableName}`);
    await db.run(`DROP TABLE "${tableName}" CASCADE CONSTRAINTS PURGE`);
  }
}
