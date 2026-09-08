import type { ReviewDto, UserRole } from "@raxtan/shared";
import { bufToUuid, uuidToBuf } from "../../db/ids.js";
import { db, type Queryable } from "../../db/query.js";
import { getStorage } from "../../lib/storage/index.js";

export async function insertReview(
  input: {
    id: string;
    commissionId: string;
    reviewerId: string;
    revieweeId: string;
    rating: number;
    body?: string;
  },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `INSERT INTO reviews (id, commission_id, reviewer_id, reviewee_id, rating, body)
     VALUES (:id, :commissionId, :reviewerId, :revieweeId, :rating, :body)`,
    {
      id: uuidToBuf(input.id),
      commissionId: uuidToBuf(input.commissionId),
      reviewerId: uuidToBuf(input.reviewerId),
      revieweeId: uuidToBuf(input.revieweeId),
      rating: input.rating,
      body: input.body ?? null,
    },
  );
}

/** Reviews written about a user, for their public profile. */
export async function listForUser(
  userId: string,
  options: { limit: number; offset: number },
  q: Queryable = db,
): Promise<{ items: ReviewDto[]; total: number }> {
  const countRow = await q.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM reviews WHERE reviewee_id = :userId`,
    { userId: uuidToBuf(userId) },
  );

  const rows = await q.many<{
    id: Buffer;
    commissionId: Buffer;
    revieweeId: Buffer;
    rating: number;
    body: string | null;
    createdAt: Date;
    reviewerId: Buffer;
    reviewerUsername: string;
    reviewerDisplayName: string;
    reviewerRole: UserRole;
    avatarId: Buffer | null;
    avatarKey: string | null;
  }>(
    `SELECT r.id, r.commission_id, r.reviewee_id, r.rating, r.body, r.created_at,
            u.id AS reviewer_id, u.username AS reviewer_username,
            u.display_name AS reviewer_display_name, u.role AS reviewer_role,
            av.id AS avatar_id, av.object_key AS avatar_key
       FROM reviews r
       JOIN users u ON u.id = r.reviewer_id
       LEFT JOIN images av ON av.id = u.avatar_image_id
      WHERE r.reviewee_id = :userId
      ORDER BY r.created_at DESC
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { userId: uuidToBuf(userId), offset: options.offset, limit: options.limit },
  );

  const storage = getStorage();
  return {
    items: rows.map((row) => ({
      id: bufToUuid(row.id)!,
      commissionId: bufToUuid(row.commissionId)!,
      reviewer: {
        id: bufToUuid(row.reviewerId)!,
        username: row.reviewerUsername,
        displayName: row.reviewerDisplayName,
        role: row.reviewerRole,
        avatar:
          row.avatarId && row.avatarKey
            ? {
                id: bufToUuid(row.avatarId)!,
                url: storage.urlFor(row.avatarKey),
                width: 0,
                height: 0,
              }
            : null,
      },
      revieweeId: bufToUuid(row.revieweeId)!,
      rating: Number(row.rating),
      createdAt: row.createdAt.toISOString(),
      ...(row.body ? { body: row.body } : {}),
    })),
    total: Number(countRow?.cnt ?? 0),
  };
}
