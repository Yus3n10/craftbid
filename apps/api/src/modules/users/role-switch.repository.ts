import type { UserRole } from "@craftbid/shared";
import { uuidToBuf } from "../../db/ids.js";
import { db, type Queryable } from "../../db/query.js";

export interface OpenWork {
  openRequests: number;
  pendingBids: number;
  activeCommissions: number;
  openProblems: number;
}

/** Everything that ties an account to its current role. */
export async function openWork(userId: string, q: Queryable = db): Promise<OpenWork> {
  const row = await q.one<{ openRequests: number; pendingBids: number; activeCommissions: number; openProblems: number }>(
    `SELECT
       (SELECT COUNT(*) FROM postings WHERE client_id = :id AND status = 'open') AS open_requests,
       (SELECT COUNT(*) FROM applications WHERE artist_id = :id AND status = 'pending') AS pending_bids,
       (SELECT COUNT(*) FROM commissions
         WHERE (client_id = :id OR artist_id = :id) AND status = 'active') AS active_commissions,
       (SELECT COUNT(*) FROM commission_problems pr
          JOIN commissions cm ON cm.id = pr.commission_id
         WHERE (cm.client_id = :id OR cm.artist_id = :id) AND pr.status = 'open') AS open_problems
     FROM dual`,
    { id: uuidToBuf(userId) },
  );
  return {
    openRequests: Number(row?.openRequests ?? 0),
    pendingBids: Number(row?.pendingBids ?? 0),
    activeCommissions: Number(row?.activeCommissions ?? 0),
    openProblems: Number(row?.openProblems ?? 0),
  };
}

export async function setRole(userId: string, role: UserRole, tx: Queryable): Promise<void> {
  await tx.run(
    `UPDATE users SET role = :role, role_changed_at = SYSTIMESTAMP, updated_at = SYSTIMESTAMP WHERE id = :id`,
    { role, id: uuidToBuf(userId) },
  );
  if (role === "artist") {
    // Kept from an earlier spell as an artist, or created the first time.
    await tx.run(
      `INSERT INTO artist_profiles (user_id)
       SELECT :id FROM dual
        WHERE NOT EXISTS (SELECT 1 FROM artist_profiles WHERE user_id = :id)`,
      { id: uuidToBuf(userId) },
    );
  }
}
