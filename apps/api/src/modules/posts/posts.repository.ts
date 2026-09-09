import type { ArtistPostDto, ImageDto, UserRole } from "@craftbid/shared";
import { bufToUuid, uuidToBuf } from "../../db/ids.js";
import { db, type BindValue, type Queryable } from "../../db/query.js";
import { getStorage } from "../../lib/storage/index.js";

interface PostRow {
  id: Buffer;
  caption: string;
  description: string | null;
  createdAt: Date;
  categorySlug: string | null;
  categoryName: string | null;
  categoryDescription: string | null;
  artistId: Buffer;
  artistUsername: string;
  artistDisplayName: string;
  artistRole: UserRole;
  avatarId: Buffer | null;
  avatarKey: string | null;
}

const POST_SELECT = `
  SELECT p.id, p.caption, p.description, p.created_at,
         c.slug AS category_slug, c.name AS category_name,
         c.description AS category_description,
         u.id AS artist_id, u.username AS artist_username,
         u.display_name AS artist_display_name, u.role AS artist_role,
         av.id AS avatar_id, av.object_key AS avatar_key
    FROM artist_posts p
    JOIN users u ON u.id = p.artist_id
    LEFT JOIN craft_categories c ON c.id = p.category_id
    LEFT JOIN images av ON av.id = u.avatar_image_id
`;

async function imagesForPosts(
  postIds: string[],
  q: Queryable,
): Promise<Map<string, ImageDto[]>> {
  const result = new Map<string, ImageDto[]>();
  if (postIds.length === 0) return result;

  const binds: Record<string, BindValue> = {};
  const placeholders = postIds.map((id, index) => {
    binds[`p${index}`] = uuidToBuf(id);
    return `:p${index}`;
  });

  const rows = await q.many<{
    postId: Buffer;
    imageId: Buffer;
    objectKey: string;
    width: number;
    height: number;
  }>(
    `SELECT pi.post_id, i.id AS image_id, i.object_key, i.width, i.height
       FROM artist_post_images pi
       JOIN images i ON i.id = pi.image_id
      WHERE pi.post_id IN (${placeholders.join(", ")})
      ORDER BY pi.post_id, pi.sort_order`,
    binds,
  );

  const storage = getStorage();
  for (const row of rows) {
    const key = bufToUuid(row.postId)!;
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

/**
 * A post as the database knows it, before the social layer is attached.
 *
 * Named as its own type so the compiler refuses a route that returns a post
 * without going through `social.decorate`. Filling in zeroes here instead
 * would have compiled and quietly served every card with no reactions.
 */
export type UndecoratedPost = Omit<
  ArtistPostDto,
  "reactions" | "commentCount" | "saved"
>;

function mapPost(row: PostRow, images: ImageDto[]): UndecoratedPost {
  const storage = getStorage();
  return {
    id: bufToUuid(row.id)!,
    caption: row.caption,
    coverImage: images[0] ?? null,
    images,
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
              width: 0,
              height: 0,
            }
          : null,
    },
    createdAt: row.createdAt.toISOString(),
    ...(row.description ? { description: row.description } : {}),
    ...(row.categorySlug
      ? {
          category: {
            slug: row.categorySlug,
            name: row.categoryName ?? "",
            description: row.categoryDescription ?? "",
          },
        }
      : {}),
  };
}

export async function findById(
  id: string,
  q: Queryable = db,
): Promise<UndecoratedPost | null> {
  const row = await q.one<PostRow>(
    `${POST_SELECT} WHERE p.id = :id AND p.status = 'published'`,
    { id: uuidToBuf(id) },
  );
  if (!row) return null;
  const images = await imagesForPosts([id], q);
  return mapPost(row, images.get(id) ?? []);
}

export async function findOwner(
  id: string,
  q: Queryable = db,
): Promise<{ artistId: string; status: string } | null> {
  const row = await q.one<{ artistId: Buffer; status: string }>(
    `SELECT artist_id, status FROM artist_posts WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  if (!row) return null;
  return { artistId: bufToUuid(row.artistId)!, status: row.status };
}

export async function list(
  filter: { artistUsername?: string; categorySlug?: string; limit: number; offset: number },
  q: Queryable = db,
): Promise<{ items: UndecoratedPost[]; total: number }> {
  const where = ["p.status = 'published'"];
  const binds: Record<string, BindValue> = {};

  if (filter.artistUsername) {
    where.push("u.username = :username");
    binds.username = filter.artistUsername.toLowerCase();
  }
  if (filter.categorySlug) {
    where.push("c.slug = :category");
    binds.category = filter.categorySlug;
  }

  const whereClause = `WHERE ${where.join(" AND ")}`;

  const countRow = await q.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
       FROM artist_posts p
       JOIN users u ON u.id = p.artist_id
       LEFT JOIN craft_categories c ON c.id = p.category_id
       ${whereClause}`,
    binds,
  );

  const rows = await q.many<PostRow>(
    `${POST_SELECT}
     ${whereClause}
     ORDER BY p.created_at DESC
     OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { ...binds, offset: filter.offset, limit: filter.limit },
  );

  const ids = rows.map((row) => bufToUuid(row.id)!);
  const images = await imagesForPosts(ids, q);

  return {
    items: rows.map((row) => mapPost(row, images.get(bufToUuid(row.id)!) ?? [])),
    total: Number(countRow?.cnt ?? 0),
  };
}

export async function insertPost(
  input: {
    id: string;
    artistId: string;
    caption: string;
    description?: string;
    categorySlug?: string;
  },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `INSERT INTO artist_posts (id, artist_id, caption, description, category_id)
     VALUES (:id, :artistId, :caption, :description,
             (SELECT id FROM craft_categories WHERE slug = :categorySlug))`,
    {
      id: uuidToBuf(input.id),
      artistId: uuidToBuf(input.artistId),
      caption: input.caption,
      description: input.description ?? null,
      categorySlug: input.categorySlug ?? null,
    },
  );
}

export async function attachImages(
  postId: string,
  imageIds: string[],
  tx: Queryable,
): Promise<void> {
  await tx.run(`DELETE FROM artist_post_images WHERE post_id = :id`, {
    id: uuidToBuf(postId),
  });
  let order = 0;
  for (const imageId of imageIds) {
    await tx.run(
      `INSERT INTO artist_post_images (post_id, image_id, sort_order)
       VALUES (:postId, :imageId, :sortOrder)`,
      {
        postId: uuidToBuf(postId),
        imageId: uuidToBuf(imageId),
        sortOrder: order++,
      },
    );
  }
}

export async function updatePost(
  id: string,
  fields: { caption?: string; description?: string | null; categorySlug?: string },
  tx: Queryable,
): Promise<void> {
  const sets: string[] = [];
  const binds: Record<string, BindValue> = { id: uuidToBuf(id) };

  if (fields.caption !== undefined) {
    sets.push("caption = :caption");
    binds.caption = fields.caption;
  }
  if (fields.description !== undefined) {
    sets.push("description = :description");
    binds.description = fields.description;
  }
  if (fields.categorySlug !== undefined) {
    sets.push(
      "category_id = (SELECT id FROM craft_categories WHERE slug = :categorySlug)",
    );
    binds.categorySlug = fields.categorySlug;
  }

  if (sets.length === 0) return;

  sets.push("updated_at = SYSTIMESTAMP");
  await tx.run(`UPDATE artist_posts SET ${sets.join(", ")} WHERE id = :id`, binds);
}

/**
 * Soft-removes a post. Kept rather than deleted because an application may
 * cite it as a work sample, and a client reviewing that bid should still see
 * what they were shown.
 */
export async function removePost(id: string, tx: Queryable): Promise<void> {
  await tx.run(
    `UPDATE artist_posts SET status = 'removed', updated_at = SYSTIMESTAMP
      WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
}
