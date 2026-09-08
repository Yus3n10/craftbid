import type {
  ApplicationDto,
  ApplicationStatus,
  ArtistPostSummaryDto,
  UserRole,
} from "@raxtan/shared";
import { bufToUuid, uuidToBuf } from "../../db/ids.js";
import { db, type BindValue, type Queryable } from "../../db/query.js";
import { getStorage } from "../../lib/storage/index.js";

interface ApplicationRow {
  id: Buffer;
  postingId: Buffer;
  proposedPriceCentavos: number;
  coverLetter: string;
  status: ApplicationStatus;
  createdAt: Date;
  artistId: Buffer;
  artistUsername: string;
  artistDisplayName: string;
  artistRole: UserRole;
  artistRegion: string | null;
  artistCity: string | null;
  avatarId: Buffer | null;
  avatarKey: string | null;
  avatarWidth: number | null;
  avatarHeight: number | null;
  ratingAvg: number | null;
  ratingCount: number;
}

const APPLICATION_SELECT = `
  SELECT a.id, a.posting_id, a.proposed_price_centavos, a.cover_letter,
         a.status, a.created_at,
         u.id AS artist_id, u.username AS artist_username,
         u.display_name AS artist_display_name, u.role AS artist_role,
         u.region AS artist_region, u.city AS artist_city,
         av.id AS avatar_id, av.object_key AS avatar_key,
         av.width AS avatar_width, av.height AS avatar_height,
         (SELECT AVG(r.rating) FROM reviews r WHERE r.reviewee_id = u.id) AS rating_avg,
         (SELECT COUNT(*) FROM reviews r WHERE r.reviewee_id = u.id) AS rating_count
    FROM applications a
    JOIN users u ON u.id = a.artist_id
    LEFT JOIN images av ON av.id = u.avatar_image_id
`;

/** Work samples attached to each application, keyed by application id. */
async function samplesFor(
  applicationIds: string[],
  q: Queryable,
): Promise<Map<string, ArtistPostSummaryDto[]>> {
  const result = new Map<string, ArtistPostSummaryDto[]>();
  if (applicationIds.length === 0) return result;

  const binds: Record<string, BindValue> = {};
  const placeholders = applicationIds.map((id, index) => {
    binds[`a${index}`] = uuidToBuf(id);
    return `:a${index}`;
  });

  const rows = await q.many<{
    applicationId: Buffer;
    postId: Buffer;
    caption: string;
    categorySlug: string | null;
    categoryName: string | null;
    categoryDescription: string | null;
    objectKey: string | null;
    width: number | null;
    height: number | null;
    imageId: Buffer | null;
  }>(
    `SELECT s.application_id, p.id AS post_id, p.caption,
            c.slug AS category_slug, c.name AS category_name,
            c.description AS category_description,
            i.id AS image_id, i.object_key, i.width, i.height
       FROM application_samples s
       JOIN artist_posts p ON p.id = s.post_id
       LEFT JOIN craft_categories c ON c.id = p.category_id
       LEFT JOIN artist_post_images pi
              ON pi.post_id = p.id AND pi.sort_order = 0
       LEFT JOIN images i ON i.id = pi.image_id
      WHERE s.application_id IN (${placeholders.join(", ")})`,
    binds,
  );

  const storage = getStorage();
  for (const row of rows) {
    const key = bufToUuid(row.applicationId)!;
    const list = result.get(key) ?? [];
    list.push({
      id: bufToUuid(row.postId)!,
      caption: row.caption,
      coverImage:
        row.imageId && row.objectKey
          ? {
              id: bufToUuid(row.imageId)!,
              url: storage.urlFor(row.objectKey),
              width: row.width ?? 0,
              height: row.height ?? 0,
            }
          : null,
      ...(row.categorySlug
        ? {
            category: {
              slug: row.categorySlug,
              name: row.categoryName ?? "",
              description: row.categoryDescription ?? "",
            },
          }
        : {}),
    });
    result.set(key, list);
  }
  return result;
}

function mapApplication(
  row: ApplicationRow,
  samples: ArtistPostSummaryDto[],
): ApplicationDto {
  const storage = getStorage();
  const count = Number(row.ratingCount);
  return {
    id: bufToUuid(row.id)!,
    postingId: bufToUuid(row.postingId)!,
    artist: {
      id: bufToUuid(row.artistId)!,
      username: row.artistUsername,
      displayName: row.artistDisplayName,
      role: row.artistRole,
      avatar:
        row.avatarId && row.avatarKey
          ? {
              id: bufToUuid(row.avatarId)!,
              url: storage.urlFor(row.avatarKey),
              width: row.avatarWidth ?? 0,
              height: row.avatarHeight ?? 0,
            }
          : null,
      ...(row.artistRegion ? { region: row.artistRegion } : {}),
      ...(row.artistCity ? { city: row.artistCity } : {}),
    },
    proposedPriceCentavos: Number(row.proposedPriceCentavos),
    coverLetter: row.coverLetter,
    status: row.status,
    samples,
    artistRating: {
      average:
        count > 0 && row.ratingAvg != null
          ? Math.round(Number(row.ratingAvg) * 10) / 10
          : null,
      count,
    },
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findById(
  id: string,
  q: Queryable = db,
): Promise<ApplicationDto | null> {
  const row = await q.one<ApplicationRow>(`${APPLICATION_SELECT} WHERE a.id = :id`, {
    id: uuidToBuf(id),
  });
  if (!row) return null;
  const samples = await samplesFor([id], q);
  return mapApplication(row, samples.get(id) ?? []);
}

/** Minimal shape for authorization checks, avoiding the full DTO assembly. */
export async function findContext(
  id: string,
  q: Queryable = db,
): Promise<{
  id: string;
  postingId: string;
  artistId: string;
  clientId: string;
  status: ApplicationStatus;
  postingStatus: string;
  proposedPriceCentavos: number;
} | null> {
  const row = await q.one<{
    id: Buffer;
    postingId: Buffer;
    artistId: Buffer;
    clientId: Buffer;
    status: ApplicationStatus;
    postingStatus: string;
    proposedPriceCentavos: number;
  }>(
    `SELECT a.id, a.posting_id, a.artist_id, a.status,
            a.proposed_price_centavos,
            p.client_id, p.status AS posting_status
       FROM applications a
       JOIN postings p ON p.id = a.posting_id
      WHERE a.id = :id`,
    { id: uuidToBuf(id) },
  );
  if (!row) return null;
  return {
    id: bufToUuid(row.id)!,
    postingId: bufToUuid(row.postingId)!,
    artistId: bufToUuid(row.artistId)!,
    clientId: bufToUuid(row.clientId)!,
    status: row.status,
    postingStatus: row.postingStatus,
    proposedPriceCentavos: Number(row.proposedPriceCentavos),
  };
}

export async function listForPosting(
  postingId: string,
  options: { status?: ApplicationStatus; limit: number; offset: number },
  q: Queryable = db,
): Promise<{ items: ApplicationDto[]; total: number }> {
  const binds: Record<string, BindValue> = { postingId: uuidToBuf(postingId) };
  let statusClause = "";
  if (options.status) {
    statusClause = " AND a.status = :status";
    binds.status = options.status;
  }

  const countRow = await q.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM applications a
      WHERE a.posting_id = :postingId${statusClause}`,
    binds,
  );

  const rows = await q.many<ApplicationRow>(
    `${APPLICATION_SELECT}
      WHERE a.posting_id = :postingId${statusClause}
      ORDER BY a.created_at DESC
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { ...binds, offset: options.offset, limit: options.limit },
  );

  const ids = rows.map((row) => bufToUuid(row.id)!);
  const samples = await samplesFor(ids, q);

  return {
    items: rows.map((row) =>
      mapApplication(row, samples.get(bufToUuid(row.id)!) ?? []),
    ),
    total: Number(countRow?.cnt ?? 0),
  };
}

export async function listForArtist(
  artistId: string,
  options: { status?: ApplicationStatus; limit: number; offset: number },
  q: Queryable = db,
): Promise<{ items: ApplicationDto[]; total: number }> {
  const binds: Record<string, BindValue> = { artistId: uuidToBuf(artistId) };
  let statusClause = "";
  if (options.status) {
    statusClause = " AND a.status = :status";
    binds.status = options.status;
  }

  const countRow = await q.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM applications a
      WHERE a.artist_id = :artistId${statusClause}`,
    binds,
  );

  const rows = await q.many<ApplicationRow>(
    `${APPLICATION_SELECT}
      WHERE a.artist_id = :artistId${statusClause}
      ORDER BY a.created_at DESC
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { ...binds, offset: options.offset, limit: options.limit },
  );

  const ids = rows.map((row) => bufToUuid(row.id)!);
  const samples = await samplesFor(ids, q);

  return {
    items: rows.map((row) =>
      mapApplication(row, samples.get(bufToUuid(row.id)!) ?? []),
    ),
    total: Number(countRow?.cnt ?? 0),
  };
}

export async function insertApplication(
  input: {
    id: string;
    postingId: string;
    artistId: string;
    proposedPriceCentavos: number;
    minPriceAtApplyCentavos: number;
    coverLetter: string;
  },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `INSERT INTO applications
       (id, posting_id, artist_id, proposed_price_centavos,
        min_price_at_apply_centavos, cover_letter)
     VALUES (:id, :postingId, :artistId, :price, :minPrice, :coverLetter)`,
    {
      id: uuidToBuf(input.id),
      postingId: uuidToBuf(input.postingId),
      artistId: uuidToBuf(input.artistId),
      price: input.proposedPriceCentavos,
      minPrice: input.minPriceAtApplyCentavos,
      coverLetter: input.coverLetter,
    },
  );
}

/**
 * Attaches work samples, but only posts the applying artist actually owns.
 * The INSERT..SELECT filters on artist_id, so passing another artist's post id
 * silently attaches nothing rather than crediting their work.
 */
export async function attachSamples(
  applicationId: string,
  postIds: string[],
  artistId: string,
  tx: Queryable,
): Promise<void> {
  for (const postId of new Set(postIds)) {
    await tx.run(
      `INSERT INTO application_samples (application_id, post_id)
       SELECT :applicationId, p.id
         FROM artist_posts p
        WHERE p.id = :postId AND p.artist_id = :artistId`,
      {
        applicationId: uuidToBuf(applicationId),
        postId: uuidToBuf(postId),
        artistId: uuidToBuf(artistId),
      },
    );
  }
}

export async function setStatus(
  id: string,
  status: ApplicationStatus,
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `UPDATE applications SET status = :status, updated_at = SYSTIMESTAMP
      WHERE id = :id`,
    { id: uuidToBuf(id), status },
  );
}
