import type { ModerationAction, ModerationRule } from "@craftbid/shared";
import { bufToUuid, newId, uuidToBuf } from "../../db/ids.js";
import { db, type Queryable } from "../../db/query.js";

export type ActionTarget = "user" | "artist_post" | "posting" | "comment" | "report" | "bug_report";

export async function recordAction(
  input: {
    staffId: string;
    action: ModerationAction;
    targetType: ActionTarget;
    targetId: string;
    subjectUserId: string | null;
    rule?: ModerationRule;
    note?: string;
  },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `INSERT INTO moderation_actions (id, staff_id, action, target_type, target_id, subject_user_id, rule, note)
     VALUES (:id, :staffId, :action, :targetType, :targetId, :subjectUserId, :rule, :note)`,
    {
      id: uuidToBuf(newId()),
      staffId: uuidToBuf(input.staffId),
      action: input.action,
      targetType: input.targetType,
      targetId: uuidToBuf(input.targetId),
      subjectUserId: input.subjectUserId ? uuidToBuf(input.subjectUserId) : null,
      rule: input.rule ?? null,
      note: input.note ?? null,
    },
  );
}

/** Conditional on the current status, so two staff acting at once cannot both succeed. */
export async function setUserStatus(
  userId: string,
  from: "active" | "suspended",
  to: "active" | "suspended" | "deleted",
  tx: Queryable,
): Promise<boolean> {
  const changed = await tx.run(
    `UPDATE users SET status = :toStatus, updated_at = SYSTIMESTAMP WHERE id = :id AND status = :fromStatus`,
    { id: uuidToBuf(userId), fromStatus: from, toStatus: to },
  );
  return changed === 1;
}

/** Takes down everything a removed account shows the public. Commissions stay. */
export async function hideAccountContent(userId: string, staffId: string, tx: Queryable): Promise<void> {
  const id = uuidToBuf(userId);
  await tx.run(`UPDATE artist_posts SET status = 'removed', updated_at = SYSTIMESTAMP WHERE artist_id = :id AND status <> 'removed'`, { id });
  await tx.run(
    `UPDATE applications SET status = 'rejected', updated_at = SYSTIMESTAMP
      WHERE status = 'pending'
        AND posting_id IN (SELECT id FROM postings WHERE client_id = :id AND status = 'open')`,
    { id },
  );
  await tx.run(
    `UPDATE postings SET status = 'cancelled', removed_at = SYSTIMESTAMP, updated_at = SYSTIMESTAMP WHERE client_id = :id AND status = 'open'`,
    { id },
  );
  await tx.run(`UPDATE applications SET status = 'withdrawn', updated_at = SYSTIMESTAMP WHERE artist_id = :id AND status = 'pending'`, { id });
  await tx.run(
    `UPDATE post_comments SET removed_at = SYSTIMESTAMP, removed_by = :staffId WHERE author_id = :id AND removed_at IS NULL`,
    { id, staffId: uuidToBuf(staffId) },
  );
  await tx.run(`DELETE FROM post_shares WHERE user_id = :id`, { id });
  await tx.run(`DELETE FROM post_reactions WHERE user_id = :id`, { id });
}

export async function findPost(id: string, q: Queryable = db) {
  const row = await q.one<{ artistId: Buffer; caption: string; status: string }>(
    `SELECT artist_id, caption, status FROM artist_posts WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  return row ? { artistId: bufToUuid(row.artistId)!, caption: row.caption, status: row.status } : null;
}

export async function removePost(id: string, tx: Queryable): Promise<void> {
  await tx.run(`UPDATE artist_posts SET status = 'removed', updated_at = SYSTIMESTAMP WHERE id = :id`, { id: uuidToBuf(id) });
}

export async function findPosting(id: string, q: Queryable = db) {
  const row = await q.one<{ clientId: Buffer; title: string; status: string; removedAt: Date | null }>(
    `SELECT client_id, title, status, removed_at FROM postings WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  return row
    ? { clientId: bufToUuid(row.clientId)!, title: row.title, status: row.status, removedAt: row.removedAt }
    : null;
}

export async function removePosting(id: string, tx: Queryable): Promise<void> {
  await tx.run(`UPDATE postings SET status = 'cancelled', removed_at = SYSTIMESTAMP, updated_at = SYSTIMESTAMP WHERE id = :id`, {
    id: uuidToBuf(id),
  });
}

export async function findComment(id: string, q: Queryable = db) {
  const row = await q.one<{ authorId: Buffer; body: string; removedAt: Date | null }>(
    `SELECT author_id, body, removed_at FROM post_comments WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  return row ? { authorId: bufToUuid(row.authorId)!, body: row.body, removedAt: row.removedAt } : null;
}

export async function removeComment(id: string, staffId: string, tx: Queryable): Promise<void> {
  await tx.run(
    `UPDATE post_comments SET removed_at = SYSTIMESTAMP, removed_by = :staffId WHERE id = :id AND removed_at IS NULL`,
    { id: uuidToBuf(id), staffId: uuidToBuf(staffId) },
  );
}

export async function closeReport(
  reportId: string,
  staffId: string,
  outcome: "reviewed" | "dismissed",
  note: string | undefined,
  tx: Queryable,
): Promise<boolean> {
  const changed = await tx.run(
    `UPDATE reports
        SET status = :outcome, resolved_by = :staffId, resolved_at = SYSTIMESTAMP, resolution_note = :note
      WHERE id = :id AND status = 'open'`,
    { id: uuidToBuf(reportId), staffId: uuidToBuf(staffId), outcome, note: note ?? null },
  );
  return changed === 1;
}

export async function resolveBug(bugId: string, staffId: string, tx: Queryable): Promise<boolean> {
  const changed = await tx.run(
    `UPDATE bug_reports SET status = 'resolved', resolved_at = SYSTIMESTAMP, resolved_by = :staffId
      WHERE id = :id AND status = 'open'`,
    { id: uuidToBuf(bugId), staffId: uuidToBuf(staffId) },
  );
  return changed === 1;
}
