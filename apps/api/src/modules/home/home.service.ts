import type { HomeItemDto, Paginated } from "@craftbid/shared";
import { assembleFeed } from "../posts/posts.service.js";
import * as postings from "../postings/postings.repository.js";
import * as repo from "./home.repository.js";

/**
 * The home feed for one viewer: work, shares of work, and open requests, in
 * the order `homeEntries` ranks them.
 *
 * A request is sent without its bid count or commission. The public request
 * list shows a count, but the feed is the social surface, and nothing about
 * bidding belongs there.
 */
export async function homeFeed(
  filter: { category?: string; limit: number; offset: number },
  viewerId: string | null,
): Promise<Paginated<HomeItemDto>> {
  const { entries, total } = await repo.homeEntries(viewerId, {
    ...(filter.category ? { categorySlug: filter.category } : {}),
    limit: filter.limit,
    offset: filter.offset,
  });

  const postEntries = entries.flatMap((entry) => (entry.kind === "post" ? [entry] : []));
  const requestIds = entries.flatMap((entry) => (entry.kind === "request" ? [entry.postingId] : []));
  const [posts, requests] = await Promise.all([
    assembleFeed(postEntries, viewerId),
    postings.findManyByIds(requestIds),
  ]);

  const postsByKey = new Map(posts.map((post) => [post.share?.id ?? post.id, post]));
  const items: HomeItemDto[] = [];
  for (const entry of entries) {
    if (entry.kind === "post") {
      const post = postsByKey.get(entry.shareId ?? entry.postId);
      if (post) items.push({ kind: "post", ...post });
      continue;
    }
    const request = requests.get(entry.postingId);
    if (!request) continue;
    const { applicationCount: _count, commissionId: _commission, ...card } = request;
    items.push({ kind: "request", ...card });
  }

  return { items, total, limit: filter.limit, offset: filter.offset };
}
