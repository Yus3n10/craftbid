import { bufToUuid } from "../db/ids.js";
import { db, withTransaction } from "../db/query.js";
import * as notifications from "../modules/notifications/notifications.repository.js";

/**
 * The unread-chat notice: an in-app notification for someone who has left a
 * message from the other person unread for an hour. Once per unread stretch:
 * after a notice, that person is not told again until they have read the
 * conversation and something new has waited another hour.
 */

const WAIT_MS = 60 * 60_000;
const EPOCH = `TIMESTAMP '1970-01-01 00:00:00 UTC'`;

/**
 * Each side's columns, chosen from this fixed map and never from input. The
 * reader is told about messages written by the other side.
 */
const SIDES = {
  client: { reader: "client_id", writer: "artist_id", lastRead: "client_last_read_at", nudgedFor: "client_nudged_for_read" },
  artist: { reader: "artist_id", writer: "client_id", lastRead: "artist_last_read_at", nudgedFor: "artist_nudged_for_read" },
} as const;

/** Still possible to write in: the same rule the chat service applies. */
const OPEN = `(
  (a.status = 'pending' AND p.status = 'open')
  OR (a.status = 'accepted' AND cm.id IS NOT NULL AND cm.status <> 'cancelled')
)`;

export async function runChatNudges(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - WAIT_MS);
  let created = 0;

  for (const side of Object.values(SIDES)) {
    const due = await db.many<{ id: Buffer; readerId: Buffer; postingTitle: string; fromName: string }>(
      `SELECT c.id, c.${side.reader} AS reader_id, p.title AS posting_title, w.display_name AS from_name
         FROM conversations c
         JOIN postings p ON p.id = c.posting_id
         JOIN applications a ON a.posting_id = c.posting_id AND a.artist_id = c.artist_id
         LEFT JOIN commissions cm ON cm.posting_id = c.posting_id AND cm.artist_id = c.artist_id
         JOIN users w ON w.id = c.${side.writer}
        WHERE ${OPEN}
          AND (c.${side.nudgedFor} IS NULL OR c.${side.nudgedFor} <> NVL(c.${side.lastRead}, ${EPOCH}))
          AND EXISTS (
            SELECT 1 FROM messages m
             WHERE m.conversation_id = c.id
               AND m.sender_id = c.${side.writer}
               AND m.created_at > NVL(c.${side.lastRead}, ${EPOCH})
               AND m.created_at <= :cutoff
          )`,
      { cutoff },
    );

    for (const row of due) {
      await withTransaction(async (tx) => {
        // The same condition again, as the claim: a second tick running at the
        // same moment changes no row and sends nothing.
        const claimed = await tx.run(
          `UPDATE conversations
              SET ${side.nudgedFor} = NVL(${side.lastRead}, ${EPOCH})
            WHERE id = :id
              AND (${side.nudgedFor} IS NULL OR ${side.nudgedFor} <> NVL(${side.lastRead}, ${EPOCH}))`,
          { id: row.id },
        );
        if (claimed !== 1) return;
        await notifications.notify(
          {
            userId: bufToUuid(row.readerId)!,
            type: "chat_unread",
            payload: { conversationId: bufToUuid(row.id)!, postingTitle: row.postingTitle, fromName: row.fromName },
          },
          tx,
        );
        created += 1;
      });
    }
  }

  return created;
}
