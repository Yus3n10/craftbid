import { bufToUuid, uuidToBuf } from "../../db/ids.js";
import { db, type BindValue, type Queryable } from "../../db/query.js";
import { decayedScore, secondsSince } from "../interests/interests.repository.js";

export type HomeEntry =
  | { kind: "post"; postId: string; shareId: string | null }
  | { kind: "request"; postingId: string };

/** Only the newest this many items are ranked. Older work is still on Discover. */
export const HOME_CANDIDATES = 500;

/** Freshness halves every 36 hours. */
const FRESHNESS_HALF_LIFE_HOURS = 36;

/**
 * Under this age an item gets a full extra step of lift, which puts it above
 * everything older however much the viewer likes the older item's craft. This
 * is what makes something new appear at the top when the page is refreshed.
 */
const FRESH_HOURS = 6;

/** Interest is capped here and scaled to 0..1, so it can at most double a rank. */
const INTEREST_CAP = 10;

/** An artist's own crafts count this much, without being stored. */
const OWN_CRAFT_SCORE = 2;

/**
 * The home feed's order for one viewer (or nobody).
 *
 * Candidates are published posts, shares of published posts, and open
 * requests from active clients, newest 500. Each is ranked by
 * `freshness * (1 + fresh + interest)`, where freshness halves every 36 hours,
 * `fresh` is 1 under six hours old, and interest is the viewer's decayed
 * interest in the item's craft (plus their own crafts, for an artist), capped
 * and scaled to 0..1. The viewer's own items from the last 24 hours come first.
 *
 * Signed out, every viewer bind is NULL: nothing is "mine" and there is no
 * interest, so the order is simply newest first.
 */
export async function homeEntries(
  viewerId: string | null,
  filter: { categorySlug?: string; limit: number; offset: number },
  q: Queryable = db,
): Promise<{ entries: HomeEntry[]; total: number }> {
  const category = filter.categorySlug ? "AND c.slug = :category" : "";
  const binds: Record<string, BindValue> = {
    viewer: viewerId ? uuidToBuf(viewerId) : null,
    ...(filter.categorySlug ? { category: filter.categorySlug } : {}),
  };

  const recent = `
    SELECT * FROM (
      SELECT 'post' AS kind, p.id AS item_id, CAST(NULL AS RAW(16)) AS share_id,
             p.category_id, p.created_at AS at,
             CASE WHEN p.artist_id = :viewer THEN 1 ELSE 0 END AS mine
        FROM artist_posts p
        LEFT JOIN craft_categories c ON c.id = p.category_id
       WHERE p.status = 'published' ${category}
      UNION ALL
      SELECT 'post', s.post_id, s.id, p.category_id, s.created_at,
             CASE WHEN s.user_id = :viewer THEN 1 ELSE 0 END
        FROM post_shares s
        JOIN artist_posts p ON p.id = s.post_id
        LEFT JOIN craft_categories c ON c.id = p.category_id
       WHERE p.status = 'published' ${category}
      UNION ALL
      SELECT 'request', r.id, NULL, r.category_id, r.created_at,
             CASE WHEN r.client_id = :viewer THEN 1 ELSE 0 END
        FROM postings r
        JOIN users u ON u.id = r.client_id
        JOIN craft_categories c ON c.id = r.category_id
       WHERE r.status = 'open' AND r.removed_at IS NULL AND u.status = 'active' ${category}
    )
    ORDER BY at DESC
    FETCH FIRST ${HOME_CANDIDATES} ROWS ONLY`;

  const ranked = `
    WITH recent AS (${recent}),
    interest AS (
      SELECT category_id, LEAST(SUM(score), ${INTEREST_CAP}) / ${INTEREST_CAP} AS weight
        FROM (
          SELECT category_id, ${decayedScore("score", "updated_at")} AS score
            FROM user_category_interest
           WHERE user_id = :viewer
          UNION ALL
          SELECT category_id, ${OWN_CRAFT_SCORE}
            FROM artist_categories
           WHERE artist_id = :viewer
        )
       GROUP BY category_id
    ),
    aged AS (
      SELECT r.kind, r.item_id, r.share_id, r.at, r.mine,
             ${secondsSince("r.at")} / 3600 AS age_hours,
             NVL(i.weight, 0) AS interest
        FROM recent r
        LEFT JOIN interest i ON i.category_id = r.category_id
    )
    SELECT kind, item_id, share_id
      FROM aged
     ORDER BY CASE WHEN mine = 1 AND age_hours < 24 THEN 1 ELSE 0 END DESC,
              POWER(0.5, GREATEST(age_hours, 0) / ${FRESHNESS_HALF_LIFE_HOURS})
                * (1 + CASE WHEN age_hours < ${FRESH_HOURS} THEN 1 ELSE 0 END + interest) DESC,
              at DESC,
              item_id`;

  const [countRow, rows] = await Promise.all([
    q.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM (${recent})`, binds),
    q.many<{ kind: "post" | "request"; itemId: Buffer; shareId: Buffer | null }>(
      `${ranked} OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { ...binds, offset: filter.offset, limit: filter.limit },
    ),
  ]);

  return {
    entries: rows.map((row): HomeEntry =>
      row.kind === "request"
        ? { kind: "request", postingId: bufToUuid(row.itemId)! }
        : { kind: "post", postId: bufToUuid(row.itemId)!, shareId: bufToUuid(row.shareId) },
    ),
    total: Number(countRow?.cnt ?? 0),
  };
}
