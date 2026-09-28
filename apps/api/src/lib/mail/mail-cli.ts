import { config } from "../../config.js";

/**
 * What happened to the email this site tried to send.
 *
 *   pnpm --filter @craftbid/api mail recent [count]
 *   pnpm --filter @craftbid/api mail failures [hours]
 *
 * Point it at production with ENV_FILE=.env.adb, as with migrations.
 *
 * This exists because a sender that stops working is otherwise silent: people
 * are told to check an inbox, nothing arrives, and the only trace is a line in
 * a log nobody is watching.
 */
async function main(): Promise<void> {
  const [command = "recent", value] = process.argv.slice(2);
  const { initPool } = await import("../../db/pool.js");
  await initPool();
  const { recentMail, failureCount } = await import("./mail-log.repository.js");

  console.log(`Database: ${config.db.connectString}\n`);

  if (command === "failures") {
    const hours = Number(value ?? 24);
    const count = await failureCount(hours);
    console.log(`${count} failed send(s) in the last ${hours} hour(s).`);
    if (count > 0) console.log(`Run "mail recent" for the reasons.`);
    return;
  }

  if (command !== "recent") {
    console.error(`Unknown command "${command}". Use recent or failures.`);
    process.exitCode = 1;
    return;
  }

  const rows = await recentMail(Number(value ?? 50));
  if (rows.length === 0) {
    console.log("Nothing sent yet.");
    return;
  }

  for (const row of rows) {
    const when = new Date(row.createdAt).toISOString().replace("T", " ").slice(0, 19);
    const mark = row.status === "sent" ? "ok  " : "FAIL";
    console.log(`${when}  ${mark}  ${row.kind.padEnd(16)} ${row.recipient}`);
    if (row.error) console.log(`                          ${row.error}`);
  }

  const failed = rows.filter((row) => row.status === "failed").length;
  console.log(`\n${rows.length} shown, ${failed} failed.`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
