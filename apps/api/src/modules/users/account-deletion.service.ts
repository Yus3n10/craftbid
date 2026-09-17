import { withTransaction } from "../../db/query.js";
import { badRequest, unauthorized } from "../../lib/errors.js";
import { verifyPassword } from "../../lib/password.js";
import * as sessions from "../auth/auth.repository.js";
import * as moderationRepo from "../moderation/moderation.repository.js";
import * as repo from "./account-deletion.repository.js";
import { openWork } from "./role-switch.repository.js";
import * as users from "./users.repository.js";

/**
 * Closes the caller's own account.
 *
 * Refused while someone else depends on it being there: a commission in
 * progress, or an open reported problem. Everything else is settled on the
 * way out, the same way staff removal settles it (open requests cancelled,
 * pending bids withdrawn, posts and comments taken down, shares and reactions
 * deleted), and then the personal details are scrubbed.
 *
 * A staff account has to lose staff access first, through the staff CLI, so
 * the admin screen is never left without anyone by accident.
 */
export async function closeOwnAccount(userId: string, password: string): Promise<void> {
  const user = await users.findById(userId);
  if (!user || user.status !== "active") throw unauthorized();

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw badRequest("That password is not right.", { password: "That password is not right." });
  }
  if (user.isStaff) {
    throw badRequest("Staff accounts cannot be closed here. Remove staff access first.");
  }

  const work = await openWork(userId);
  if (work.activeCommissions > 0) {
    throw badRequest("You have a commission in progress. Finish or cancel it before closing your account.");
  }
  if (work.openProblems > 0) {
    throw badRequest("A reported problem on one of your commissions is still open. It has to be settled first.");
  }

  await withTransaction(async (tx) => {
    if (!(await moderationRepo.setUserStatus(userId, "active", "deleted", tx))) {
      throw badRequest("Your account changed a moment ago. Reload and try again.");
    }
    await sessions.revokeAllForUser(userId, tx);
    await moderationRepo.hideAccountContent(userId, userId, tx);
    // Asked again now that pending bids are withdrawn inside this transaction:
    // a client accepting one of them a moment earlier would otherwise leave a
    // commission with nobody on the other end. An accept still in flight now
    // waits on those rows and finds the bid withdrawn.
    if ((await openWork(userId, tx)).activeCommissions > 0) {
      throw badRequest("You have a commission in progress. Finish or cancel it before closing your account.");
    }
    await repo.scrubPersonalData(userId, tx);
  });
}
