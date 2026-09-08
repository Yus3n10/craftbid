import type {
  CategoryDto,
  ExternalLinkDto,
  ImageDto,
  LinkPlatform,
  RatingSummaryDto,
  UserRole,
} from "@raxtan/shared";
import { bufToUuid, newId, uuidToBuf } from "../../db/ids.js";
import { db, type BindValue, type Queryable } from "../../db/query.js";
import { getStorage } from "../../lib/storage/index.js";

export interface ProfileRow {
  id: Buffer;
  email: string;
  username: string;
  displayName: string;
  role: UserRole;
  bio: string | null;
  region: string | null;
  city: string | null;
  createdAt: Date;
  avatarId: Buffer | null;
  avatarKey: string | null;
  avatarWidth: number | null;
  avatarHeight: number | null;
  coverId: Buffer | null;
  coverKey: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  headline: string | null;
  acceptingCommissions: number | null;
}

const PROFILE_SELECT = `
  SELECT u.id, u.email, u.username, u.display_name, u.role, u.bio, u.region,
         u.city, u.created_at,
         av.id AS avatar_id, av.object_key AS avatar_key,
         av.width AS avatar_width, av.height AS avatar_height,
         cv.id AS cover_id, cv.object_key AS cover_key,
         cv.width AS cover_width, cv.height AS cover_height,
         ap.headline, ap.accepting_commissions
    FROM users u
    LEFT JOIN images av ON av.id = u.avatar_image_id
    LEFT JOIN images cv ON cv.id = u.cover_image_id
    LEFT JOIN artist_profiles ap ON ap.user_id = u.id
`;

export function imageFrom(
  id: Buffer | null,
  key: string | null,
  width: number | null,
  height: number | null,
): ImageDto | null {
  if (!id || !key) return null;
  return {
    id: bufToUuid(id)!,
    url: getStorage().urlFor(key),
    width: width ?? 0,
    height: height ?? 0,
  };
}

export async function findProfileByUsername(
  username: string,
  q: Queryable = db,
): Promise<ProfileRow | null> {
  return q.one<ProfileRow>(
    `${PROFILE_SELECT} WHERE u.username = :username AND u.status = 'active'`,
    { username: username.toLowerCase() },
  );
}

export async function findProfileById(
  id: string,
  q: Queryable = db,
): Promise<ProfileRow | null> {
  return q.one<ProfileRow>(`${PROFILE_SELECT} WHERE u.id = :id`, {
    id: uuidToBuf(id),
  });
}

export async function findLinks(
  userId: string,
  q: Queryable = db,
): Promise<ExternalLinkDto[]> {
  const rows = await q.many<{
    platform: LinkPlatform;
    url: string;
    label: string | null;
  }>(
    `SELECT platform, url, label
       FROM external_links
      WHERE user_id = :userId
      ORDER BY sort_order, platform`,
    { userId: uuidToBuf(userId) },
  );
  return rows.map((row) => ({
    platform: row.platform,
    url: row.url,
    ...(row.label ? { label: row.label } : {}),
  }));
}

export async function findCategories(
  artistId: string,
  q: Queryable = db,
): Promise<CategoryDto[]> {
  return q.many<CategoryDto>(
    `SELECT c.slug, c.name, c.description
       FROM artist_categories ac
       JOIN craft_categories c ON c.id = ac.category_id
      WHERE ac.artist_id = :artistId
      ORDER BY c.sort_order`,
    { artistId: uuidToBuf(artistId) },
  );
}

export async function findSkills(
  artistId: string,
  q: Queryable = db,
): Promise<string[]> {
  const rows = await q.many<{ skill: string }>(
    `SELECT skill FROM artist_skills WHERE artist_id = :artistId ORDER BY skill`,
    { artistId: uuidToBuf(artistId) },
  );
  return rows.map((row) => row.skill);
}

/**
 * Ratings are aggregated on read rather than kept as a running total on the
 * user row. At this scale the indexed aggregate is cheap, and a stored average
 * is one more thing that can silently disagree with the reviews behind it.
 */
export async function findRating(
  userId: string,
  q: Queryable = db,
): Promise<RatingSummaryDto> {
  const row = await q.one<{ avgRating: number | null; cnt: number }>(
    `SELECT AVG(rating) AS avg_rating, COUNT(*) AS cnt
       FROM reviews
      WHERE reviewee_id = :userId`,
    { userId: uuidToBuf(userId) },
  );
  const count = Number(row?.cnt ?? 0);
  return {
    average:
      count > 0 && row?.avgRating != null
        ? Math.round(Number(row.avgRating) * 10) / 10
        : null,
    count,
  };
}

export async function countCompletedCommissions(
  userId: string,
  q: Queryable = db,
): Promise<number> {
  const row = await q.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
       FROM commissions
      WHERE status = 'completed'
        AND (client_id = :userId OR artist_id = :userId)`,
    { userId: uuidToBuf(userId) },
  );
  return Number(row?.cnt ?? 0);
}

export interface UpdateProfileFields {
  displayName?: string;
  bio?: string | null;
  region?: string | null;
  city?: string | null;
  avatarImageId?: string | null;
  coverImageId?: string | null;
}

/**
 * Builds the UPDATE from only the fields actually supplied, so a PATCH that
 * omits `bio` leaves the existing bio alone instead of clearing it.
 */
export async function updateProfile(
  userId: string,
  fields: UpdateProfileFields,
  q: Queryable = db,
): Promise<void> {
  const sets: string[] = [];
  const binds: Record<string, BindValue> = { id: uuidToBuf(userId) };

  const assign = (column: string, key: string, value: BindValue): void => {
    sets.push(`${column} = :${key}`);
    binds[key] = value;
  };

  if (fields.displayName !== undefined) {
    assign("display_name", "displayName", fields.displayName);
  }
  if (fields.bio !== undefined) assign("bio", "bio", fields.bio);
  if (fields.region !== undefined) assign("region", "region", fields.region);
  if (fields.city !== undefined) assign("city", "city", fields.city);
  if (fields.avatarImageId !== undefined) {
    assign(
      "avatar_image_id",
      "avatarImageId",
      fields.avatarImageId ? uuidToBuf(fields.avatarImageId) : null,
    );
  }
  if (fields.coverImageId !== undefined) {
    assign(
      "cover_image_id",
      "coverImageId",
      fields.coverImageId ? uuidToBuf(fields.coverImageId) : null,
    );
  }

  if (sets.length === 0) return;

  sets.push("updated_at = SYSTIMESTAMP");
  await q.run(`UPDATE users SET ${sets.join(", ")} WHERE id = :id`, binds);
}

export async function updateArtistProfile(
  artistId: string,
  fields: { headline?: string | null; acceptingCommissions?: boolean },
  q: Queryable = db,
): Promise<void> {
  const sets: string[] = [];
  const binds: Record<string, BindValue> = { id: uuidToBuf(artistId) };

  if (fields.headline !== undefined) {
    sets.push("headline = :headline");
    binds.headline = fields.headline;
  }
  if (fields.acceptingCommissions !== undefined) {
    sets.push("accepting_commissions = :accepting");
    binds.accepting = fields.acceptingCommissions ? 1 : 0;
  }

  if (sets.length === 0) return;

  sets.push("updated_at = SYSTIMESTAMP");
  await q.run(
    `UPDATE artist_profiles SET ${sets.join(", ")} WHERE user_id = :id`,
    binds,
  );
}

/** Replaces the artist's category set wholesale. */
export async function setCategories(
  artistId: string,
  slugs: string[],
  tx: Queryable,
): Promise<void> {
  await tx.run(`DELETE FROM artist_categories WHERE artist_id = :id`, {
    id: uuidToBuf(artistId),
  });
  for (const slug of slugs) {
    await tx.run(
      `INSERT INTO artist_categories (artist_id, category_id)
       SELECT :id, id FROM craft_categories WHERE slug = :slug`,
      { id: uuidToBuf(artistId), slug },
    );
  }
}

export async function setSkills(
  artistId: string,
  skills: string[],
  tx: Queryable,
): Promise<void> {
  await tx.run(`DELETE FROM artist_skills WHERE artist_id = :id`, {
    id: uuidToBuf(artistId),
  });
  for (const skill of new Set(skills)) {
    await tx.run(
      `INSERT INTO artist_skills (artist_id, skill) VALUES (:id, :skill)`,
      { id: uuidToBuf(artistId), skill },
    );
  }
}

export async function setLinks(
  userId: string,
  links: { platform: string; url: string; label?: string }[],
  tx: Queryable,
): Promise<void> {
  await tx.run(`DELETE FROM external_links WHERE user_id = :id`, {
    id: uuidToBuf(userId),
  });
  let order = 0;
  for (const link of links) {
    await tx.run(
      `INSERT INTO external_links (id, user_id, platform, url, label, sort_order)
       VALUES (:id, :userId, :platform, :url, :label, :sortOrder)`,
      {
        id: uuidToBuf(newId()),
        userId: uuidToBuf(userId),
        platform: link.platform,
        url: link.url,
        label: link.label ?? null,
        sortOrder: order++,
      },
    );
  }
}
