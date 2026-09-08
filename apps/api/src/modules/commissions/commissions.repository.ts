import type {
  CommissionDto,
  CommissionStatus,
  PostingStatus,
  ReviewDto,
  UserRole,
} from "@raxtan/shared";
import { bufToUuid, uuidToBuf } from "../../db/ids.js";
import { db, type BindValue, type Queryable } from "../../db/query.js";
import { getStorage } from "../../lib/storage/index.js";

interface CommissionRow {
  id: Buffer;
  agreedPriceCentavos: number;
  status: CommissionStatus;
  startedAt: Date;
  completedAt: Date | null;
  postingId: Buffer;
  postingTitle: string;
  postingStatus: PostingStatus;
  clientId: Buffer;
  clientUsername: string;
  clientDisplayName: string;
  clientAvatarId: Buffer | null;
  clientAvatarKey: string | null;
  artistId: Buffer;
  artistUsername: string;
  artistDisplayName: string;
  artistAvatarId: Buffer | null;
  artistAvatarKey: string | null;
}

const COMMISSION_SELECT = `
  SELECT cm.id, cm.agreed_price_centavos, cm.status, cm.started_at, cm.completed_at,
         p.id AS posting_id, p.title AS posting_title, p.status AS posting_status,
         cl.id AS client_id, cl.username AS client_username,
         cl.display_name AS client_display_name,
         cav.id AS client_avatar_id, cav.object_key AS client_avatar_key,
         ar.id AS artist_id, ar.username AS artist_username,
         ar.display_name AS artist_display_name,
         aav.id AS artist_avatar_id, aav.object_key AS artist_avatar_key
    FROM commissions cm
    JOIN postings p ON p.id = cm.posting_id
    JOIN users cl ON cl.id = cm.client_id
    JOIN users ar ON ar.id = cm.artist_id
    LEFT JOIN images cav ON cav.id = cl.avatar_image_id
    LEFT JOIN images aav ON aav.id = ar.avatar_image_id
`;

function summary(
  id: Buffer,
  username: string,
  displayName: string,
  role: UserRole,
  avatarId: Buffer | null,
  avatarKey: string | null,
) {
  return {
    id: bufToUuid(id)!,
    username,
    displayName,
    role,
    avatar:
      avatarId && avatarKey
        ? {
            id: bufToUuid(avatarId)!,
            url: getStorage().urlFor(avatarKey),
            width: 0,
            height: 0,
          }
        : null,
  };
}

async function reviewsFor(
  commissionId: string,
  q: Queryable,
): Promise<ReviewDto[]> {
  const rows = await q.many<{
    id: Buffer;
    revieweeId: Buffer;
    rating: number;
    body: string | null;
    createdAt: Date;
    reviewerId: Buffer;
    reviewerUsername: string;
    reviewerDisplayName: string;
    reviewerRole: UserRole;
    reviewerAvatarId: Buffer | null;
    reviewerAvatarKey: string | null;
  }>(
    `SELECT r.id, r.reviewee_id, r.rating, r.body, r.created_at,
            u.id AS reviewer_id, u.username AS reviewer_username,
            u.display_name AS reviewer_display_name, u.role AS reviewer_role,
            av.id AS reviewer_avatar_id, av.object_key AS reviewer_avatar_key
       FROM reviews r
       JOIN users u ON u.id = r.reviewer_id
       LEFT JOIN images av ON av.id = u.avatar_image_id
      WHERE r.commission_id = :id
      ORDER BY r.created_at`,
    { id: uuidToBuf(commissionId) },
  );

  return rows.map((row) => ({
    id: bufToUuid(row.id)!,
    commissionId,
    reviewer: summary(
      row.reviewerId,
      row.reviewerUsername,
      row.reviewerDisplayName,
      row.reviewerRole,
      row.reviewerAvatarId,
      row.reviewerAvatarKey,
    ),
    revieweeId: bufToUuid(row.revieweeId)!,
    rating: Number(row.rating),
    createdAt: row.createdAt.toISOString(),
    ...(row.body ? { body: row.body } : {}),
  }));
}

function mapCommission(
  row: CommissionRow,
  reviews: ReviewDto[],
  viewerId: string,
): CommissionDto {
  const id = bufToUuid(row.id)!;
  const alreadyReviewed = reviews.some((r) => r.reviewer.id === viewerId);
  const isParticipant =
    viewerId === bufToUuid(row.clientId) || viewerId === bufToUuid(row.artistId);

  return {
    id,
    posting: {
      id: bufToUuid(row.postingId)!,
      title: row.postingTitle,
      status: row.postingStatus,
    },
    client: summary(
      row.clientId,
      row.clientUsername,
      row.clientDisplayName,
      "client",
      row.clientAvatarId,
      row.clientAvatarKey,
    ),
    artist: summary(
      row.artistId,
      row.artistUsername,
      row.artistDisplayName,
      "artist",
      row.artistAvatarId,
      row.artistAvatarKey,
    ),
    agreedPriceCentavos: Number(row.agreedPriceCentavos),
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    // A review is only offered to a participant, on a completed commission,
    // who has not already written one.
    canReview: row.status === "completed" && isParticipant && !alreadyReviewed,
    reviews,
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
  };
}

export async function findById(
  id: string,
  viewerId: string,
  q: Queryable = db,
): Promise<CommissionDto | null> {
  const row = await q.one<CommissionRow>(`${COMMISSION_SELECT} WHERE cm.id = :id`, {
    id: uuidToBuf(id),
  });
  if (!row) return null;
  return mapCommission(row, await reviewsFor(id, q), viewerId);
}

/** Minimal shape for authorization, without assembling the whole DTO. */
export async function findContext(
  id: string,
  q: Queryable = db,
): Promise<{
  id: string;
  postingId: string;
  clientId: string;
  artistId: string;
  status: CommissionStatus;
} | null> {
  const row = await q.one<{
    id: Buffer;
    postingId: Buffer;
    clientId: Buffer;
    artistId: Buffer;
    status: CommissionStatus;
  }>(
    `SELECT id, posting_id, client_id, artist_id, status
       FROM commissions WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  if (!row) return null;
  return {
    id: bufToUuid(row.id)!,
    postingId: bufToUuid(row.postingId)!,
    clientId: bufToUuid(row.clientId)!,
    artistId: bufToUuid(row.artistId)!,
    status: row.status,
  };
}

export async function listForUser(
  userId: string,
  options: { status?: CommissionStatus; limit: number; offset: number },
  q: Queryable = db,
): Promise<{ items: CommissionDto[]; total: number }> {
  const binds: Record<string, BindValue> = { userId: uuidToBuf(userId) };
  let statusClause = "";
  if (options.status) {
    statusClause = " AND cm.status = :status";
    binds.status = options.status;
  }

  const countRow = await q.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM commissions cm
      WHERE (cm.client_id = :userId OR cm.artist_id = :userId)${statusClause}`,
    binds,
  );

  const rows = await q.many<CommissionRow>(
    `${COMMISSION_SELECT}
      WHERE (cm.client_id = :userId OR cm.artist_id = :userId)${statusClause}
      ORDER BY cm.started_at DESC
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { ...binds, offset: options.offset, limit: options.limit },
  );

  const items = await Promise.all(
    rows.map(async (row) =>
      mapCommission(row, await reviewsFor(bufToUuid(row.id)!, q), userId),
    ),
  );

  return { items, total: Number(countRow?.cnt ?? 0) };
}

export async function insertCommission(
  input: {
    id: string;
    postingId: string;
    applicationId: string;
    clientId: string;
    artistId: string;
    agreedPriceCentavos: number;
  },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `INSERT INTO commissions
       (id, posting_id, application_id, client_id, artist_id, agreed_price_centavos)
     VALUES (:id, :postingId, :applicationId, :clientId, :artistId, :price)`,
    {
      id: uuidToBuf(input.id),
      postingId: uuidToBuf(input.postingId),
      applicationId: uuidToBuf(input.applicationId),
      clientId: uuidToBuf(input.clientId),
      artistId: uuidToBuf(input.artistId),
      price: input.agreedPriceCentavos,
    },
  );
}

export async function complete(id: string, tx: Queryable): Promise<void> {
  await tx.run(
    `UPDATE commissions
        SET status = 'completed', completed_at = SYSTIMESTAMP
      WHERE id = :id AND status = 'active'`,
    { id: uuidToBuf(id) },
  );
}

export async function cancel(id: string, tx: Queryable): Promise<void> {
  await tx.run(
    `UPDATE commissions
        SET status = 'cancelled', cancelled_at = SYSTIMESTAMP
      WHERE id = :id AND status = 'active'`,
    { id: uuidToBuf(id) },
  );
}
