import type {
  ImageDto,
  PostingDto,
  PostingListQuery,
  PostingStatus,
  UserRole,
} from "@craftbid/shared";
import { bufToUuid, uuidToBuf } from "../../db/ids.js";
import { db, type BindValue, type Queryable } from "../../db/query.js";
import { getStorage } from "../../lib/storage/index.js";

interface PostingRow {
  id: Buffer;
  title: string;
  description: string;
  requirements: string | null;
  minBudgetCentavos: number;
  deadline: Date | null;
  status: PostingStatus;
  createdAt: Date;
  updatedAt: Date;
  categorySlug: string;
  categoryName: string;
  categoryDescription: string;
  clientId: Buffer;
  clientUsername: string;
  clientDisplayName: string;
  clientRole: UserRole;
  clientRegion: string | null;
  clientCity: string | null;
  clientAvatarId: Buffer | null;
  clientAvatarKey: string | null;
  clientAvatarWidth: number | null;
  clientAvatarHeight: number | null;
  applicationCount: number;
  commissionId: Buffer | null;
}

const POSTING_SELECT = `
  SELECT p.id, p.title, p.description, p.requirements, p.min_budget_centavos,
         p.deadline, p.status, p.created_at, p.updated_at,
         c.slug AS category_slug, c.name AS category_name,
         c.description AS category_description,
         u.id AS client_id, u.username AS client_username,
         u.display_name AS client_display_name, u.role AS client_role,
         u.region AS client_region, u.city AS client_city,
         av.id AS client_avatar_id, av.object_key AS client_avatar_key,
         av.width AS client_avatar_width, av.height AS client_avatar_height,
         (SELECT COUNT(*) FROM applications a WHERE a.posting_id = p.id) AS application_count,
         (SELECT cm.id FROM commissions cm WHERE cm.posting_id = p.id) AS commission_id
    FROM postings p
    JOIN craft_categories c ON c.id = p.category_id
    JOIN users u ON u.id = p.client_id
    LEFT JOIN images av ON av.id = u.avatar_image_id
`;

/**
 * Images are fetched in a second query keyed by posting id rather than joined.
 * Joining a one-to-many would multiply every posting row by its image count and
 * force de-duplication in application code.
 */
async function imagesForPostings(
  postingIds: string[],
  q: Queryable,
): Promise<Map<string, ImageDto[]>> {
  const result = new Map<string, ImageDto[]>();
  if (postingIds.length === 0) return result;

  const binds: Record<string, BindValue> = {};
  const placeholders = postingIds.map((id, index) => {
    binds[`p${index}`] = uuidToBuf(id);
    return `:p${index}`;
  });

  const rows = await q.many<{
    postingId: Buffer;
    imageId: Buffer;
    objectKey: string;
    width: number;
    height: number;
  }>(
    `SELECT pi.posting_id, i.id AS image_id, i.object_key, i.width, i.height
       FROM posting_images pi
       JOIN images i ON i.id = pi.image_id
      WHERE pi.posting_id IN (${placeholders.join(", ")})
      ORDER BY pi.posting_id, pi.sort_order`,
    binds,
  );

  const storage = getStorage();
  for (const row of rows) {
    const key = bufToUuid(row.postingId)!;
    const list = result.get(key) ?? [];
    list.push({
      id: bufToUuid(row.imageId)!,
      url: storage.urlFor(row.objectKey),
      width: row.width,
      height: row.height,
    });
    result.set(key, list);
  }
  return result;
}

function mapPosting(row: PostingRow, images: ImageDto[]): PostingDto {
  const storage = getStorage();
  return {
    id: bufToUuid(row.id)!,
    title: row.title,
    description: row.description,
    category: {
      slug: row.categorySlug,
      name: row.categoryName,
      description: row.categoryDescription,
    },
    minBudgetCentavos: Number(row.minBudgetCentavos),
    status: row.status,
    images,
    client: {
      id: bufToUuid(row.clientId)!,
      username: row.clientUsername,
      displayName: row.clientDisplayName,
      role: row.clientRole,
      avatar:
        row.clientAvatarId && row.clientAvatarKey
          ? {
              id: bufToUuid(row.clientAvatarId)!,
              url: storage.urlFor(row.clientAvatarKey),
              width: row.clientAvatarWidth ?? 0,
              height: row.clientAvatarHeight ?? 0,
            }
          : null,
      ...(row.clientRegion ? { region: row.clientRegion } : {}),
      ...(row.clientCity ? { city: row.clientCity } : {}),
    },
    applicationCount: Number(row.applicationCount),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.requirements ? { requirements: row.requirements } : {}),
    ...(row.deadline ? { deadline: row.deadline.toISOString() } : {}),
    ...(row.commissionId ? { commissionId: bufToUuid(row.commissionId)! } : {}),
  };
}

export async function findById(
  id: string,
  q: Queryable = db,
): Promise<PostingDto | null> {
  const row = await q.one<PostingRow>(`${POSTING_SELECT} WHERE p.id = :id`, {
    id: uuidToBuf(id),
  });
  if (!row) return null;
  const images = await imagesForPostings([id], q);
  return mapPosting(row, images.get(id) ?? []);
}

/** The bare row, for ownership and state checks that do not need the full DTO. */
export async function findOwnership(
  id: string,
  q: Queryable = db,
): Promise<{ clientId: string; status: PostingStatus; minBudgetCentavos: number } | null> {
  const row = await q.one<{
    clientId: Buffer;
    status: PostingStatus;
    minBudgetCentavos: number;
  }>(
    `SELECT client_id, status, min_budget_centavos FROM postings WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  if (!row) return null;
  return {
    clientId: bufToUuid(row.clientId)!,
    status: row.status,
    minBudgetCentavos: Number(row.minBudgetCentavos),
  };
}

export interface PostingListResult {
  items: PostingDto[];
  total: number;
}

export async function list(
  query: PostingListQuery & { clientId?: string },
  q: Queryable = db,
): Promise<PostingListResult> {
  const where: string[] = [];
  const binds: Record<string, BindValue> = {};

  if (query.status) {
    where.push("p.status = :status");
    binds.status = query.status;
  }
  if (query.category) {
    where.push("c.slug = :category");
    binds.category = query.category;
  }
  if (query.clientId) {
    where.push("p.client_id = :clientId");
    binds.clientId = uuidToBuf(query.clientId);
  }
  if (query.minBudget !== undefined) {
    where.push("p.min_budget_centavos >= :minBudget");
    binds.minBudget = query.minBudget;
  }
  if (query.maxBudget !== undefined) {
    where.push("p.min_budget_centavos <= :maxBudget");
    binds.maxBudget = query.maxBudget;
  }
  if (query.q) {
    // A substring match cannot use a b-tree index, so this scans. Fine at MVP
    // volume; Oracle Text would be the upgrade if the table grows.
    where.push("(UPPER(p.title) LIKE :search OR UPPER(p.description) LIKE :search)");
    binds.search = `%${query.q.toUpperCase()}%`;
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const orderBy = {
    newest: "p.created_at DESC",
    oldest: "p.created_at ASC",
    budget_high: "p.min_budget_centavos DESC, p.created_at DESC",
    budget_low: "p.min_budget_centavos ASC, p.created_at DESC",
  }[query.sort];

  const countRow = await q.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
       FROM postings p
       JOIN craft_categories c ON c.id = p.category_id
       ${whereClause}`,
    binds,
  );

  const rows = await q.many<PostingRow>(
    `${POSTING_SELECT}
     ${whereClause}
     ORDER BY ${orderBy}
     OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { ...binds, offset: query.offset, limit: query.limit },
  );

  const ids = rows.map((row) => bufToUuid(row.id)!);
  const images = await imagesForPostings(ids, q);

  return {
    items: rows.map((row) => {
      const id = bufToUuid(row.id)!;
      return mapPosting(row, images.get(id) ?? []);
    }),
    total: Number(countRow?.cnt ?? 0),
  };
}

export async function insertPosting(
  input: {
    id: string;
    clientId: string;
    title: string;
    description: string;
    categorySlug: string;
    minBudgetCentavos: number;
    requirements?: string;
    deadline?: Date;
  },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `INSERT INTO postings
       (id, client_id, title, description, category_id, min_budget_centavos,
        requirements, deadline)
     SELECT :id, :clientId, :title, :description, c.id, :minBudget,
            :requirements, :deadline
       FROM craft_categories c
      WHERE c.slug = :categorySlug`,
    {
      id: uuidToBuf(input.id),
      clientId: uuidToBuf(input.clientId),
      title: input.title,
      description: input.description,
      categorySlug: input.categorySlug,
      minBudget: input.minBudgetCentavos,
      requirements: input.requirements ?? null,
      deadline: input.deadline ?? null,
    },
  );
}

export async function attachImages(
  postingId: string,
  imageIds: string[],
  tx: Queryable,
): Promise<void> {
  await tx.run(`DELETE FROM posting_images WHERE posting_id = :id`, {
    id: uuidToBuf(postingId),
  });
  let order = 0;
  for (const imageId of imageIds) {
    await tx.run(
      `INSERT INTO posting_images (posting_id, image_id, sort_order)
       VALUES (:postingId, :imageId, :sortOrder)`,
      {
        postingId: uuidToBuf(postingId),
        imageId: uuidToBuf(imageId),
        sortOrder: order++,
      },
    );
  }
}

export async function updatePosting(
  id: string,
  fields: {
    title?: string;
    description?: string;
    categorySlug?: string;
    minBudgetCentavos?: number;
    requirements?: string | null;
    deadline?: Date | null;
  },
  tx: Queryable,
): Promise<void> {
  const sets: string[] = [];
  const binds: Record<string, BindValue> = { id: uuidToBuf(id) };

  if (fields.title !== undefined) {
    sets.push("title = :title");
    binds.title = fields.title;
  }
  if (fields.description !== undefined) {
    sets.push("description = :description");
    binds.description = fields.description;
  }
  if (fields.minBudgetCentavos !== undefined) {
    sets.push("min_budget_centavos = :minBudget");
    binds.minBudget = fields.minBudgetCentavos;
  }
  if (fields.requirements !== undefined) {
    sets.push("requirements = :requirements");
    binds.requirements = fields.requirements;
  }
  if (fields.deadline !== undefined) {
    sets.push("deadline = :deadline");
    binds.deadline = fields.deadline;
  }
  if (fields.categorySlug !== undefined) {
    sets.push(
      "category_id = (SELECT id FROM craft_categories WHERE slug = :categorySlug)",
    );
    binds.categorySlug = fields.categorySlug;
  }

  if (sets.length === 0) return;

  sets.push("updated_at = SYSTIMESTAMP");
  await tx.run(`UPDATE postings SET ${sets.join(", ")} WHERE id = :id`, binds);
}

export async function setStatus(
  id: string,
  status: PostingStatus,
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `UPDATE postings SET status = :status, updated_at = SYSTIMESTAMP WHERE id = :id`,
    { id: uuidToBuf(id), status },
  );
}

/**
 * Rejects every still-pending application on a posting. Used when the client
 * selects someone else, or cancels outright, so no artist is left waiting on a
 * decision that has already been made.
 */
export async function rejectPendingApplications(
  postingId: string,
  tx: Queryable,
  exceptApplicationId?: string,
): Promise<number> {
  const binds: Record<string, BindValue> = { id: uuidToBuf(postingId) };
  let exclusion = "";
  if (exceptApplicationId) {
    exclusion = " AND id <> :exceptId";
    binds.exceptId = uuidToBuf(exceptApplicationId);
  }
  return tx.run(
    `UPDATE applications
        SET status = 'rejected', updated_at = SYSTIMESTAMP
      WHERE posting_id = :id AND status = 'pending'${exclusion}`,
    binds,
  );
}

export async function countApplications(
  postingId: string,
  q: Queryable = db,
): Promise<number> {
  const row = await q.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM applications WHERE posting_id = :id`,
    { id: uuidToBuf(postingId) },
  );
  return Number(row?.cnt ?? 0);
}

/** The viewer's own application on a posting, if they have one. */
export async function findViewerApplicationId(
  postingId: string,
  artistId: string,
  q: Queryable = db,
): Promise<string | null> {
  const row = await q.one<{ id: Buffer }>(
    `SELECT id FROM applications WHERE posting_id = :postingId AND artist_id = :artistId`,
    { postingId: uuidToBuf(postingId), artistId: uuidToBuf(artistId) },
  );
  return row ? bufToUuid(row.id) : null;
}
