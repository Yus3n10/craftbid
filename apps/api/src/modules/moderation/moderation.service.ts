import type { ModerationInput } from "@craftbid/shared";
import { withTransaction, type Queryable } from "../../db/query.js";
import { badRequest, notFound } from "../../lib/errors.js";
import * as sessions from "../auth/auth.repository.js";
import * as notifications from "../notifications/notifications.repository.js";
import * as postingsRepo from "../postings/postings.repository.js";
import * as users from "../users/users.repository.js";
import * as repo from "./moderation.repository.js";
import * as adminPayments from "../admin/admin-payments.repository.js";
import * as payments from "../commission-payments/commission-payments.service.js";
import { getStorage } from "../../lib/storage/index.js";

/**
 * Everything staff can do to people and their content.
 *
 * Each action and its audit row commit together, so the log cannot miss an
 * action or record one that did not happen.
 */

const excerpt = (text: string) => (text.length > 80 ? `${text.slice(0, 77)}...` : text);

/** Staff never act on themselves or on each other: that is how an admin gets locked out. */
async function moderatable(staffId: string, userId: string) {
  if (staffId === userId) throw badRequest("You cannot do this to your own account.");
  const user = await users.findById(userId);
  if (!user || user.status === "deleted") throw notFound("That account does not exist.");
  if (user.isStaff) throw badRequest("Staff accounts cannot be moderated from the admin screen.");
  return user;
}

/** Closes the report an action came from, if there was one and it is still open. */
async function settle(staffId: string, input: ModerationInput, tx: Queryable): Promise<void> {
  if (!input.reportId) return;
  if (await repo.closeReport(input.reportId, staffId, "reviewed", input.note, tx)) {
    await repo.recordAction(
      { staffId, action: "resolve_report", targetType: "report", targetId: input.reportId, subjectUserId: null, note: input.note },
      tx,
    );
  }
}

export async function warn(staffId: string, userId: string, input: ModerationInput): Promise<void> {
  await moderatable(staffId, userId);
  await withTransaction(async (tx) => {
    await notifications.notify(
      { userId, type: "account_warning", payload: { rule: input.rule, note: input.note ?? null } },
      tx,
    );
    await repo.recordAction(
      { staffId, action: "warn", targetType: "user", targetId: userId, subjectUserId: userId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function suspend(staffId: string, userId: string, input: ModerationInput): Promise<void> {
  await moderatable(staffId, userId);
  await withTransaction(async (tx) => {
    if (!(await repo.setUserStatus(userId, "active", "suspended", tx))) {
      throw badRequest("This account is not active.");
    }
    await sessions.revokeAllForUser(userId, tx);
    await repo.recordAction(
      { staffId, action: "suspend", targetType: "user", targetId: userId, subjectUserId: userId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function unsuspend(staffId: string, userId: string, note?: string): Promise<void> {
  await moderatable(staffId, userId);
  await withTransaction(async (tx) => {
    if (!(await repo.setUserStatus(userId, "suspended", "active", tx))) {
      throw badRequest("This account is not suspended.");
    }
    await repo.recordAction(
      { staffId, action: "unsuspend", targetType: "user", targetId: userId, subjectUserId: userId, note },
      tx,
    );
  });
}

export async function removeAccount(staffId: string, userId: string, input: ModerationInput): Promise<void> {
  const user = await moderatable(staffId, userId);
  await withTransaction(async (tx) => {
    const from = user.status === "suspended" ? "suspended" : "active";
    if (!(await repo.setUserStatus(userId, from, "deleted", tx))) {
      throw badRequest("This account changed while you were looking at it. Reload and try again.");
    }
    await sessions.revokeAllForUser(userId, tx);
    await repo.hideAccountContent(userId, staffId, tx);
    await repo.recordAction(
      { staffId, action: "remove_account", targetType: "user", targetId: userId, subjectUserId: userId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function removePost(staffId: string, postId: string, input: ModerationInput): Promise<void> {
  const post = await repo.findPost(postId);
  if (!post || post.status === "removed") throw notFound("That post does not exist or is already removed.");
  await withTransaction(async (tx) => {
    await repo.removePost(postId, tx);
    await notifications.notify(
      {
        userId: post.artistId,
        type: "content_removed",
        payload: { kind: "post", excerpt: excerpt(post.caption), rule: input.rule, note: input.note ?? null },
      },
      tx,
    );
    await repo.recordAction(
      { staffId, action: "remove_post", targetType: "artist_post", targetId: postId, subjectUserId: post.artistId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function removePosting(staffId: string, postingId: string, input: ModerationInput): Promise<void> {
  const posting = await repo.findPosting(postingId);
  if (!posting || posting.removedAt) throw notFound("That request does not exist or is already removed.");
  if (posting.status !== "open") {
    throw badRequest(
      "An artist is already working on this request, or it is closed. Handle it through the commission instead.",
    );
  }
  await withTransaction(async (tx) => {
    await postingsRepo.rejectPendingApplications(postingId, tx);
    await repo.removePosting(postingId, tx);
    await notifications.notify(
      {
        userId: posting.clientId,
        type: "content_removed",
        payload: { kind: "posting", excerpt: excerpt(posting.title), rule: input.rule, note: input.note ?? null },
      },
      tx,
    );
    await repo.recordAction(
      { staffId, action: "remove_posting", targetType: "posting", targetId: postingId, subjectUserId: posting.clientId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function removeComment(staffId: string, commentId: string, input: ModerationInput): Promise<void> {
  const comment = await repo.findComment(commentId);
  if (!comment || comment.removedAt) throw notFound("That comment does not exist or is already removed.");
  await withTransaction(async (tx) => {
    await repo.removeComment(commentId, staffId, tx);
    await notifications.notify(
      {
        userId: comment.authorId,
        type: "content_removed",
        payload: { kind: "comment", excerpt: excerpt(comment.body), rule: input.rule, note: input.note ?? null },
      },
      tx,
    );
    await repo.recordAction(
      { staffId, action: "remove_comment", targetType: "comment", targetId: commentId, subjectUserId: comment.authorId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function closeReport(
  staffId: string,
  reportId: string,
  outcome: "reviewed" | "dismissed",
  note?: string,
): Promise<void> {
  await withTransaction(async (tx) => {
    if (!(await repo.closeReport(reportId, staffId, outcome, note, tx))) {
      throw notFound("That report does not exist or is already closed.");
    }
    await repo.recordAction(
      {
        staffId,
        action: outcome === "reviewed" ? "resolve_report" : "dismiss_report",
        targetType: "report",
        targetId: reportId,
        subjectUserId: null,
        note,
      },
      tx,
    );
  });
}

export async function resolveBug(staffId: string, bugId: string): Promise<void> {
  await withTransaction(async (tx) => {
    if (!(await repo.resolveBug(bugId, staffId, tx))) {
      throw notFound("That bug report does not exist or is already resolved.");
    }
    await repo.recordAction(
      { staffId, action: "resolve_bug", targetType: "bug_report", targetId: bugId, subjectUserId: null },
      tx,
    );
  });
}

/**
 * Settles a reported commission problem from the admin screen. The outcome,
 * the notices to both people and the audit row commit together.
 */
export async function resolveProblem(
  staffId: string,
  problemId: string,
  input: { outcome: "continue" | "cancel"; note: string },
): Promise<void> {
  await payments.resolveProblem(problemId, input.outcome, input.note, (tx) =>
    repo.recordAction(
      {
        staffId,
        action: "resolve_problem",
        targetType: "problem",
        targetId: problemId,
        subjectUserId: null,
        note: `${input.outcome === "cancel" ? "Cancelled the commission" : "Commission continues"}: ${input.note}`,
      },
      tx,
    ),
  );
}

/**
 * The receipt behind a payment record, for staff. Every look is recorded:
 * receipts carry names and account numbers, and reading one is itself
 * something the log should show.
 */
export async function viewPaymentReceipt(
  staffId: string,
  paymentId: string,
): Promise<{ body: Buffer; contentType: string }> {
  const receipt = await adminPayments.receiptOf(paymentId);
  if (!receipt) throw notFound("That payment has no receipt.");
  const body = await getStorage().getPrivate(receipt.objectKey);
  if (!body) throw notFound("That receipt is no longer stored.");
  await withTransaction((tx) =>
    repo.recordAction(
      { staffId, action: "payment_file_viewed", targetType: "payment", targetId: paymentId, subjectUserId: receipt.clientId },
      tx,
    ),
  );
  return { body, contentType: receipt.contentType };
}
