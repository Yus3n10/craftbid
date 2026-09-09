import type { NotificationDto, NotificationType } from "@craftbid/shared";
import { bufToUuid, newId, uuidToBuf } from "../../db/ids.js";
import { db, type Queryable } from "../../db/query.js";

/**
 * In-app notifications only. No email and no SMS: both cost money at volume,
 * and the budget for this project is zero. The rows here are enough to drive a
 * bell icon and an activity list.
 */
export async function notify(
  input: { userId: string; type: NotificationType; payload: Record<string, unknown> },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `INSERT INTO notifications (id, user_id, type, payload)
     VALUES (:id, :userId, :type, :payload)`,
    {
      id: uuidToBuf(newId()),
      userId: uuidToBuf(input.userId),
      type: input.type,
      payload: JSON.stringify(input.payload),
    },
  );
}

export async function listForUser(
  userId: string,
  options: { limit: number; offset: number },
  q: Queryable = db,
): Promise<{ items: NotificationDto[]; total: number; unread: number }> {
  const [countRow, unreadRow, rows] = await Promise.all([
    q.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = :userId`,
      { userId: uuidToBuf(userId) },
    ),
    q.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM notifications
        WHERE user_id = :userId AND read_at IS NULL`,
      { userId: uuidToBuf(userId) },
    ),
    q.many<{
      id: Buffer;
      type: NotificationType;
      payload: string;
      readAt: Date | null;
      createdAt: Date;
    }>(
      `SELECT id, type, payload, read_at, created_at
         FROM notifications
        WHERE user_id = :userId
        ORDER BY created_at DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { userId: uuidToBuf(userId), offset: options.offset, limit: options.limit },
    ),
  ]);

  return {
    items: rows.map((row) => ({
      id: bufToUuid(row.id)!,
      type: row.type,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    })),
    total: Number(countRow?.cnt ?? 0),
    unread: Number(unreadRow?.cnt ?? 0),
  };
}

export async function markAllRead(
  userId: string,
  q: Queryable = db,
): Promise<number> {
  return q.run(
    `UPDATE notifications SET read_at = SYSTIMESTAMP
      WHERE user_id = :userId AND read_at IS NULL`,
    { userId: uuidToBuf(userId) },
  );
}

/**
 * Inserts a notification, replacing any unread one already sent by the same
 * person about the same post.
 *
 * Without this, someone cycling love to support to like leaves three notices
 * for one opinion, and a post that collects a few undecided readers buries
 * everything else in the list. Only unread notices are replaced: one already
 * read is a record of something the recipient saw, and rewriting history under
 * them is worse than a duplicate.
 */
export async function notifyOncePerActor(
  input: {
    userId: string;
    type: NotificationType;
    postId: string;
    actorId: string;
    payload: Record<string, unknown>;
  },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `DELETE FROM notifications
      WHERE user_id = :userId
        AND type = :type
        AND read_at IS NULL
        AND JSON_VALUE(payload, '$.postId') = :postId
        AND JSON_VALUE(payload, '$.actorId') = :actorId`,
    {
      userId: uuidToBuf(input.userId),
      type: input.type,
      postId: input.postId,
      actorId: input.actorId,
    },
  );

  await notify(
    {
      userId: input.userId,
      type: input.type,
      payload: { ...input.payload, postId: input.postId, actorId: input.actorId },
    },
    tx,
  );
}
