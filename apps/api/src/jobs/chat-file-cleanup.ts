import { db, withTransaction } from "../db/query.js";
import { getStorage } from "../lib/storage/index.js";

/**
 * Chat images uploaded and never sent: the photo was chosen, then removed, or
 * the page was closed before Send. After a day nobody is coming back for them,
 * and they only take up storage.
 */

const ABANDONED_AFTER_MS = 24 * 3_600_000;
/** A bounded amount of work per tick; the rest waits five minutes. */
const BATCH = 50;

export async function runChatFileCleanup(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ABANDONED_AFTER_MS);
  const rows = await db.many<{ id: Buffer; objectKey: string }>(
    `SELECT f.id, f.object_key
       FROM chat_files f
      WHERE f.created_at < :cutoff
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.file_id = f.id)
      FETCH FIRST ${BATCH} ROWS ONLY`,
    { cutoff },
  );

  const removed: string[] = [];
  for (const row of rows) {
    await withTransaction(async (tx) => {
      // Still unattached at the moment of deleting, in case it was sent just now.
      const deleted = await tx.run(
        `DELETE FROM chat_files f WHERE f.id = :id AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.file_id = f.id)`,
        { id: row.id },
      );
      if (deleted === 1) removed.push(row.objectKey);
    });
  }

  // After the rows are gone, so a storage outage cannot leave a message
  // pointing at a file the database says is deleted.
  const storage = getStorage();
  for (const key of removed) {
    await storage.removePrivate(key).catch((error: unknown) => {
      console.error(`Could not remove abandoned chat image ${key}`, error);
    });
  }
  return removed.length;
}
