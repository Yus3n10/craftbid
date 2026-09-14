import { ROLE_SWITCH_COOLDOWN_DAYS, type RoleSwitchStatusDto, type UserRole } from "@craftbid/shared";
import { withTransaction } from "../../db/query.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { hashRefreshToken } from "../../lib/tokens.js";
import * as sessions from "../auth/auth.repository.js";
import { startSession, type SessionTokens } from "../auth/auth.service.js";
import * as users from "./users.repository.js";
import * as repo from "./role-switch.repository.js";

const DAY_MS = 86_400_000;

async function assess(userId: string): Promise<RoleSwitchStatusDto & { role: UserRole }> {
  const user = await users.findById(userId);
  if (!user) throw notFound("Account not found.");

  const work = await repo.openWork(userId);
  const blockers: string[] = [];
  if (work.openRequests > 0) blockers.push("You have an open craft request. Cancel it or choose an artist first.");
  if (work.pendingBids > 0) blockers.push("You have a bid waiting for an answer. Withdraw it or wait for the client first.");
  if (work.activeCommissions > 0) blockers.push("You have a commission in progress. Finish or cancel it first.");
  if (work.openProblems > 0) blockers.push("A reported problem on one of your commissions is still open.");

  let nextAllowedAt: string | null = null;
  if (user.roleChangedAt) {
    const next = user.roleChangedAt.getTime() + ROLE_SWITCH_COOLDOWN_DAYS * DAY_MS;
    if (next > Date.now()) {
      nextAllowedAt = new Date(next).toISOString();
      blockers.push(`You switched recently. You can switch again after ${new Date(next).toDateString()}.`);
    }
  }

  return { role: user.role, allowed: blockers.length === 0, blockers, nextAllowedAt };
}

export async function getRoleSwitchStatus(userId: string): Promise<RoleSwitchStatusDto> {
  const { allowed, blockers, nextAllowedAt } = await assess(userId);
  return { allowed, blockers, nextAllowedAt };
}

/**
 * Changes the account's role and starts a fresh session carrying it.
 *
 * Every existing session is revoked, which signs out the account's other
 * devices; the caller gets the new session back, so the device that switched
 * stays signed in. The new session is persistent only if the one presented was.
 */
export async function switchRole(
  userId: string,
  role: UserRole,
  presentedRefreshToken: string | undefined,
): Promise<SessionTokens> {
  const status = await assess(userId);
  if (status.role === role) throw badRequest(`This account is already a ${role}.`);
  if (!status.allowed) throw badRequest(status.blockers.join(" "));

  const persistent = presentedRefreshToken
    ? Boolean((await sessions.findByTokenHash(hashRefreshToken(presentedRefreshToken)))?.persistent)
    : false;

  await withTransaction(async (tx) => {
    // Re-checked inside the transaction so a request posted a moment ago
    // cannot slip past the assessment above.
    const work = await repo.openWork(userId, tx);
    if (work.openRequests + work.pendingBids + work.activeCommissions + work.openProblems > 0) {
      throw badRequest("Something is still open on this account. Reload and check again.");
    }
    await repo.setRole(userId, role, tx);
    await sessions.revokeAllForUser(userId, tx);
  });

  return startSession(userId, role, persistent);
}
