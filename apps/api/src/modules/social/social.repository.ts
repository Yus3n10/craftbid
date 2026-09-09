import type {
  ArtistPostDto,
  CommentDto,
  ReactionKind,
  ReactionSummary,
} from "@craftbid/shared";
import { db, type BindValue, type Queryable } from "../../db/query.js";
import { bufToUuid, newId, uuidToBuf } from "../../db/ids.js";
import { getStorage } from "../../lib/storage/index.js";
import type { UndecoratedPost } from "../posts/posts.repository.js";

/**
 * Reactions, comments and saves.
 *
 * Written as a decorator over posts rather than folded into the post queries.
 * A feed of twenty cards needs three aggregate lookups, and doing them once for
 * the whole page is the difference between four queries and sixty-one. It also
 * keeps the portfolio code unaware that a social layer exists.
 */

/** Oracle has no array bind, so an id list has to be expanded into binds. */
function idList(ids: string[], prefix: string) {
  const binds: Record<string, BindValue> = {};
  const placeholders = ids.map((id, index) => {
    binds[`${prefix}${index}`] = uuidToBuf(id);
    return `:${prefix}${index}`;
  });
  return { sql: placeholders.join(", "), binds };
}

const EMPTY: ReactionSummary = {
  love: 0,
  support: 0,
  like: 0,
  total: 0,
  mine: null,
};

export async function reactionSummaries(
  postIds: string[],
  viewerId: string | null,
  q: Queryable = db,
): Promise<Map<string, ReactionSummary>> {
  const out = new Map<string, ReactionSummary>();
  if (postIds.length === 0) return out;

  const { sql, binds } = idList(postIds, "p");

  const counts = await q.many<{ postId: Buffer; kind: ReactionKind; cnt: number }>(
    `SELECT post_id, kind, COUNT(*) AS cnt
       FROM post_reactions
      WHERE post_id IN (${sql})
      GROUP BY post_id, kind`,
    binds,
  );

  for (const row of counts) {
    const id = bufToUuid(row.postId)!;
    const current = out.get(id) ?? { ...EMPTY };
    current[row.kind] = Number(row.cnt);
    current.total += Number(row.cnt);
    out.set(id, current);
  }

  if (viewerId) {
    const mine = await q.many<{ postId: Buffer; kind: ReactionKind }>(
      `SELECT post_id, kind FROM post_reactions
        WHERE user_id = :viewer AND post_id IN (${sql})`,
      { ...binds, viewer: uuidToBuf(viewerId) },
    );
    for (const row of mine) {
      const id = bufToUuid(row.postId)!;
      const current = out.get(id) ?? { ...EMPTY };
      current.mine = row.kind;
      out.set(id, current);
    }
  }

  return out;
}

export async function commentCounts(
  postIds: string[],
  q: Queryable = db,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (postIds.length === 0) return out;

  const { sql, binds } = idList(postIds, "p");
  const rows = await q.many<{ postId: Buffer; cnt: number }>(
    `SELECT post_id, COUNT(*) AS cnt FROM post_comments
      WHERE post_id IN (${sql}) GROUP BY post_id`,
    binds,
  );
  for (const row of rows) out.set(bufToUuid(row.postId)!, Number(row.cnt));
  return out;
}

export async function savedSet(
  postIds: string[],
  viewerId: string,
  q: Queryable = db,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (postIds.length === 0) return out;

  const { sql, binds } = idList(postIds, "p");
  const rows = await q.many<{ postId: Buffer }>(
    `SELECT post_id FROM saved_posts
      WHERE user_id = :viewer AND post_id IN (${sql})`,
    { ...binds, viewer: uuidToBuf(viewerId) },
  );
  for (const row of rows) out.add(bufToUuid(row.postId)!);
  return out;
}

/**
 * Attaches the social counts to posts that were loaded without them.
 *
 * Every route that returns a post goes through here, so a card in the feed and
 * the same card on a profile cannot disagree about how many people liked it.
 */
export async function decorate(
  posts: UndecoratedPost[],
  viewerId: string | null,
  q: Queryable = db,
): Promise<ArtistPostDto[]> {
  if (posts.length === 0) return [];

  const ids = posts.map((post) => post.id);
  const [reactions, comments, saved] = await Promise.all([
    reactionSummaries(ids, viewerId, q),
    commentCounts(ids, q),
    viewerId ? savedSet(ids, viewerId, q) : Promise.resolve(new Set<string>()),
  ]);

  return posts.map((post) => ({
    ...post,
    reactions: reactions.get(post.id) ?? { ...EMPTY },
    commentCount: comments.get(post.id) ?? 0,
    ...(viewerId ? { saved: saved.has(post.id) } : {}),
  }));
}

export async function setReaction(
  postId: string,
  userId: string,
  kind: ReactionKind,
  tx: Queryable = db,
): Promise<void> {
  // Reacting again replaces rather than stacks, so the primary key is the
  // whole mechanism and MERGE keeps it to one round trip.
  await tx.run(
    `MERGE INTO post_reactions r
     USING (SELECT :postId AS post_id, :userId AS user_id FROM dual) s
        ON (r.post_id = s.post_id AND r.user_id = s.user_id)
      WHEN MATCHED THEN UPDATE SET r.kind = :kind, r.created_at = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (post_id, user_id, kind)
           VALUES (s.post_id, s.user_id, :kind)`,
    { postId: uuidToBuf(postId), userId: uuidToBuf(userId), kind },
  );
}

export async function clearReaction(
  postId: string,
  userId: string,
  tx: Queryable = db,
): Promise<void> {
  await tx.run(
    `DELETE FROM post_reactions WHERE post_id = :postId AND user_id = :userId`,
    { postId: uuidToBuf(postId), userId: uuidToBuf(userId) },
  );
}

export async function listComments(
  postId: string,
  viewerId: string | null,
  q: Queryable = db,
): Promise<CommentDto[]> {
  const storage = getStorage();
  const rows = await q.many<{
    id: Buffer;
    body: string;
    createdAt: Date;
    authorId: Buffer;
    username: string;
    displayName: string;
    role: "client" | "artist";
    avatarId: Buffer | null;
    avatarKey: string | null;
  }>(
    `SELECT c.id, c.body, c.created_at,
            u.id AS author_id, u.username, u.display_name, u.role,
            av.id AS avatar_id, av.object_key AS avatar_key
       FROM post_comments c
       JOIN users u ON u.id = c.author_id
       LEFT JOIN images av ON av.id = u.avatar_image_id
      WHERE c.post_id = :postId
      ORDER BY c.created_at`,
    { postId: uuidToBuf(postId) },
  );

  return rows.map((row) => ({
    id: bufToUuid(row.id)!,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    mine: viewerId !== null && bufToUuid(row.authorId) === viewerId,
    author: {
      id: bufToUuid(row.authorId)!,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
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
  }));
}

export async function insertComment(
  postId: string,
  authorId: string,
  body: string,
  tx: Queryable = db,
): Promise<string> {
  const id = newId();
  await tx.run(
    `INSERT INTO post_comments (id, post_id, author_id, body)
     VALUES (:id, :postId, :authorId, :body)`,
    {
      id: uuidToBuf(id),
      postId: uuidToBuf(postId),
      authorId: uuidToBuf(authorId),
      body,
    },
  );
  return id;
}

export async function findComment(
  id: string,
  q: Queryable = db,
): Promise<{ authorId: string; postId: string } | null> {
  const row = await q.one<{ authorId: Buffer; postId: Buffer }>(
    `SELECT author_id, post_id FROM post_comments WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  return row
    ? { authorId: bufToUuid(row.authorId)!, postId: bufToUuid(row.postId)! }
    : null;
}

export async function deleteComment(id: string, tx: Queryable = db): Promise<void> {
  await tx.run(`DELETE FROM post_comments WHERE id = :id`, { id: uuidToBuf(id) });
}

export async function setSaved(
  postId: string,
  userId: string,
  saved: boolean,
  tx: Queryable = db,
): Promise<void> {
  if (!saved) {
    await tx.run(
      `DELETE FROM saved_posts WHERE post_id = :postId AND user_id = :userId`,
      { postId: uuidToBuf(postId), userId: uuidToBuf(userId) },
    );
    return;
  }

  await tx.run(
    `MERGE INTO saved_posts s
     USING (SELECT :postId AS post_id, :userId AS user_id FROM dual) x
        ON (s.post_id = x.post_id AND s.user_id = x.user_id)
      WHEN NOT MATCHED THEN INSERT (user_id, post_id)
           VALUES (x.user_id, x.post_id)`,
    { postId: uuidToBuf(postId), userId: uuidToBuf(userId) },
  );
}

/** Post ids this user saved, most recently saved first. */
export async function savedPostIds(
  userId: string,
  limit: number,
  offset: number,
  q: Queryable = db,
): Promise<{ ids: string[]; total: number }> {
  const total = await q.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM saved_posts WHERE user_id = :userId`,
    { userId: uuidToBuf(userId) },
  );

  const rows = await q.many<{ postId: Buffer }>(
    `SELECT post_id FROM saved_posts
      WHERE user_id = :userId
      ORDER BY created_at DESC
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { userId: uuidToBuf(userId), limit, offset },
  );

  return {
    ids: rows.map((row) => bufToUuid(row.postId)!),
    total: Number(total?.cnt ?? 0),
  };
}
