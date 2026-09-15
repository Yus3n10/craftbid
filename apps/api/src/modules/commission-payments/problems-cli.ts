import { config } from "../../config.js";
import { PROBLEM_REASONS } from "@craftbid/shared";

/**
 * Reported problems, from the command line.
 *
 * The admin screen's Problems tab is now the usual way to settle these: it
 * shows both people, the payment records and their receipts, and records who
 * resolved what. This stays as a fallback that needs only the database
 * credentials, for when the site itself is unavailable.
 *
 *   pnpm --filter @craftbid/api problems list
 *   pnpm --filter @craftbid/api problems resolve <problemId> continue "note to both"
 *   pnpm --filter @craftbid/api problems resolve <problemId> cancel "note to both"
 *
 * Point it at production with ENV_FILE=.env.adb, as with migrations.
 */

const REASON_LABEL: Record<(typeof PROBLEM_REASONS)[number], string> = {
  payment_not_received: "Payment not received",
  work_not_delivered: "Work not delivered",
  not_as_agreed: "Not as agreed",
  stopped_responding: "Stopped responding",
  other: "Other",
};

async function main(): Promise<void> {
  const [command, problemId, outcome, ...noteWords] = process.argv.slice(2);
  const { initPool } = await import("../../db/pool.js");
  await initPool();
  const service = await import("./commission-payments.service.js");

  console.log(`Database: ${config.db.connectString}\n`);

  if (command === "list" || !command) {
    const problems = await service.listOpenProblems();
    if (problems.length === 0) {
      console.log("No open problems.");
      return;
    }
    for (const problem of problems) {
      console.log(`Problem ${problem.id}`);
      console.log(`  Request:   ${problem.postingTitle}`);
      console.log(`  Reason:    ${REASON_LABEL[problem.reason]} (reported by @${problem.openedByUsername})`);
      console.log(`  Opened:    ${problem.createdAt.toISOString()}`);
      console.log(`  Client:    @${problem.clientUsername} <${problem.clientEmail}>`);
      console.log(`  Artist:    @${problem.artistUsername} <${problem.artistEmail}>`);
      console.log(`  Details:   ${problem.details.replace(/\s+/g, " ")}`);
      console.log(`  Commission ${problem.commissionId}\n`);
    }
    return;
  }

  if (command === "resolve") {
    const note = noteWords.join(" ").trim();
    if (!problemId || (outcome !== "continue" && outcome !== "cancel") || note.length < 5) {
      throw new Error(
        'Usage: problems resolve <problemId> continue|cancel "a note both parties will see"',
      );
    }
    await service.resolveProblem(problemId, outcome, note);
    console.log(
      outcome === "cancel"
        ? "Resolved. The commission was cancelled and both parties were notified."
        : "Resolved. The commission can continue and both parties were notified.",
    );
    return;
  }

  throw new Error(`Unknown command "${command}". Use list or resolve.`);
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
