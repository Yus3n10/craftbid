import { config } from "../../config.js";

/**
 * Who can open the admin screen. Only from here: nothing over HTTP grants it.
 *
 *   pnpm --filter @craftbid/api staff list
 *   pnpm --filter @craftbid/api staff grant <email>
 *   pnpm --filter @craftbid/api staff revoke <email>
 *
 * Point it at production with ENV_FILE=.env.adb, as with migrations.
 */
async function main(): Promise<void> {
  const [command, email] = process.argv.slice(2);
  const { initPool } = await import("../../db/pool.js");
  await initPool();
  const repo = await import("./admin.repository.js");

  console.log(`Database: ${config.db.connectString}\n`);

  if (command === "list" || !command) {
    const staff = await repo.listStaff();
    console.log(
      staff.length ? staff.map((s) => `@${s.username} <${s.email}> ${s.status}`).join("\n") : "No staff accounts.",
    );
    return;
  }

  if ((command === "grant" || command === "revoke") && email) {
    const changed = await repo.setStaff(email, command === "grant");
    console.log(
      changed
        ? `${command === "grant" ? "Granted" : "Revoked"} staff access for ${email}.`
        : `No account uses ${email}.`,
    );
    return;
  }

  throw new Error("Usage: staff list | staff grant <email> | staff revoke <email>");
}

main()
  .then(async () => {
    const { closePool } = await import("../../db/pool.js");
    await closePool();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error((error as Error).message ?? error);
    const { closePool } = await import("../../db/pool.js");
    await closePool();
    process.exit(1);
  });
