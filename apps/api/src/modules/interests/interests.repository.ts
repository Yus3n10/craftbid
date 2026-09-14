import { uuidToBuf } from "../../db/ids.js";
import { db, type BindValue, type Queryable } from "../../db/query.js";

/** Interest halves every 30 days without new activity. */
export const INTEREST_HALF_LIFE_DAYS = 30;

/** Seconds from a timestamp column to now, as a number, in Oracle SQL. */
export function secondsSince(column: string): string {
  return `(EXTRACT(DAY FROM (SYSTIMESTAMP - ${column})) * 86400
    + EXTRACT(HOUR FROM (SYSTIMESTAMP - ${column})) * 3600
    + EXTRACT(MINUTE FROM (SYSTIMESTAMP - ${column})) * 60
    + EXTRACT(SECOND FROM (SYSTIMESTAMP - ${column})))`;
}

/** A stored score decayed from when it was last written to now. */
export function decayedScore(scoreColumn: string, updatedColumn: string): string {
  return `${scoreColumn} * POWER(0.5, ${secondsSince(updatedColumn)} / ${INTEREST_HALF_LIFE_DAYS * 86400})`;
}

/**
 * Where each kind of target keeps its craft. Chosen from this fixed map, never
 * from anything a request sends.
 */
const CATEGORY_OF = {
  post: `SELECT category_id FROM artist_posts WHERE id = :target AND category_id IS NOT NULL`,
  share: `SELECT p.category_id
            FROM post_shares s
            JOIN artist_posts p ON p.id = s.post_id
           WHERE s.id = :target AND p.category_id IS NOT NULL`,
  posting: `SELECT category_id FROM postings WHERE id = :target`,
} as const;

export type InterestTarget = keyof typeof CATEGORY_OF;

async function merge(
  userId: string,
  source: string,
  binds: Record<string, BindValue>,
  weight: number,
  q: Queryable,
): Promise<void> {
  await q.run(
    `MERGE INTO user_category_interest t
     USING (${source}) s
        ON (t.user_id = :userId AND t.category_id = s.category_id)
      WHEN MATCHED THEN UPDATE
           SET t.score = ${decayedScore("t.score", "t.updated_at")} + :weight,
               t.updated_at = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (user_id, category_id, score)
           VALUES (:userId, s.category_id, :weight)`,
    { ...binds, userId: uuidToBuf(userId), weight },
  );
}

/** Adds weight to the craft of one post, share or request. */
export async function bumpTarget(
  userId: string,
  target: InterestTarget,
  id: string,
  weight: number,
  q: Queryable = db,
): Promise<void> {
  await merge(userId, CATEGORY_OF[target], { target: uuidToBuf(id) }, weight, q);
}

/** Adds weight to crafts named by slug. */
export async function bumpSlugs(
  userId: string,
  slugs: readonly string[],
  weight: number,
  q: Queryable = db,
): Promise<void> {
  if (slugs.length === 0) return;
  const binds: Record<string, BindValue> = {};
  const placeholders = slugs.map((slug, index) => {
    binds[`s${index}`] = slug;
    return `:s${index}`;
  });
  await merge(
    userId,
    `SELECT id AS category_id FROM craft_categories WHERE slug IN (${placeholders.join(", ")})`,
    binds,
    weight,
    q,
  );
}

/** One person's scores by craft slug, decayed to now. */
export async function scores(userId: string, q: Queryable = db): Promise<Map<string, number>> {
  const rows = await q.many<{ slug: string; score: number }>(
    `SELECT c.slug, ${decayedScore("i.score", "i.updated_at")} AS score
       FROM user_category_interest i
       JOIN craft_categories c ON c.id = i.category_id
      WHERE i.user_id = :userId`,
    { userId: uuidToBuf(userId) },
  );
  return new Map(rows.map((row) => [row.slug, Number(row.score)]));
}
