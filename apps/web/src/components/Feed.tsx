import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CRAFT_CATEGORIES,
  formatPeso,
  type FeedItemDto,
  type HomeItemDto,
  type Paginated,
  type PostingDto,
} from "@craftbid/shared";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { mayHaveSession } from "../lib/session.js";
import { cx } from "../lib/cx.js";
import { materialColor } from "../lib/materials.js";
import { ButtonLink } from "./ui/Button.js";
import { Card, ThreadRule } from "./ui/Primitives.js";
import { CardSkeleton, EmptyState, ErrorState } from "./ui/States.js";
import { FeedPost } from "./FeedPost.js";
import { FeedRequestCard } from "./FeedRequestCard.js";

type Tab = "all" | "saved";

/**
 * Who the feed is being fetched for, once that is known.
 *
 * Someone who may have a session waits for it to be confirmed (and renewed,
 * if the 15-minute access token lapsed) before the feed is asked for. Asked
 * for at the same moment, it went out with the lapsed token, came back as a
 * stranger's feed without their saves or reactions, and was what the next
 * reload showed. A first-time visitor has nothing to wait for.
 *
 * The viewer is part of the query key so signing in or out never reuses the
 * other person's copy.
 */
function useSettledViewer(): { ready: boolean; key: string } {
  const { user, isLoading } = useAuth();
  return {
    ready: !isLoading || !mayHaveSession(),
    key: user?.id ?? "anonymous",
  };
}

/**
 * The newest open craft requests, kept reachable beside the feed.
 *
 * Requests also appear in the feed itself, ranked with everything else, as
 * cards with no reactions, comments, saves or shares: bidding stays between
 * the client and each artist separately. This list is the quick way to the
 * newest ones, whatever the feed put first.
 */
function OpenRequests() {
  const viewer = useSettledViewer();
  const { data, isPending: isLoading } = useQuery({
    queryKey: ["postings", "sidebar", viewer.key],
    queryFn: () =>
      api.get<Paginated<PostingDto>>("/postings?status=open&limit=4&sort=newest"),
    enabled: viewer.ready,
  });

  const items = data?.items ?? [];

  return (
    <Card className="p-5">
      <div className="pl-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg">Open requests</h2>
          <Link to="/postings" className="text-xs text-indigo hover:underline">
            See all
          </Link>
        </div>
        <ThreadRule className="mt-2 w-12" />

        {isLoading ? (
          <p className="mt-4 text-sm text-ink-faint">Loading…</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-sm text-ink-faint">
            No open requests right now.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {items.map((posting) => (
              <li key={posting.id}>
                <Link
                  to={`/postings/${posting.id}`}
                  className="block rounded-sm p-2 -mx-2 transition-colors hover:bg-paper-sunk"
                >
                  <p className="text-sm font-medium leading-snug">{posting.title}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {posting.category.name} · from{" "}
                    <span className="tabular">
                      {formatPeso(posting.minBudgetCentavos)}
                    </span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function CategoryList() {
  return (
    <Card className="p-5">
      <div className="pl-3">
        <h2 className="font-display text-lg">Crafts</h2>
        <ThreadRule className="mt-2 w-12" />
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {CRAFT_CATEGORIES.map((category) => (
            <li key={category.slug}>
              <Link
                to={`/postings?category=${category.slug}`}
                className="inline-flex items-center gap-1.5 rounded-sm border border-fiber py-1 pl-1.5 pr-2 text-xs text-ink-soft transition-colors hover:border-fiber-strong hover:text-ink"
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-1 rounded-full"
                  style={{ background: materialColor(category.slug) }}
                />
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/**
 * The home feed: work, shares and open requests, ordered for this reader.
 *
 * /home is newer than /feed, and the site and the API deploy minutes apart.
 * When the site arrives first, /home answers 404 until the API catches up, so
 * the feed falls back to /feed (work only, newest first) rather than showing
 * an error for those minutes.
 */
async function homeFeed(): Promise<Paginated<HomeItemDto>> {
  try {
    return await api.get<Paginated<HomeItemDto>>("/home?limit=12");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    const fallback = await api.get<Paginated<FeedItemDto>>("/feed?limit=12");
    return { ...fallback, items: fallback.items.map((item) => ({ kind: "post" as const, ...item })) };
  }
}

/** What this reader saved, most recently saved first. Posts only. */
async function savedFeed(): Promise<Paginated<HomeItemDto>> {
  const saved = await api.get<Paginated<FeedItemDto>>("/feed?limit=12&saved=true");
  return { ...saved, items: saved.items.map((item) => ({ kind: "post" as const, ...item })) };
}

/**
 * The feed.
 *
 * One column of work at a readable width with the marketplace alongside it,
 * rather than a grid. A grid is right for browsing many things quickly and
 * wrong for looking at any of them, and looking is what turns a reader into
 * someone who commissions.
 */
export function Feed() {
  const { user } = useAuth();
  const viewer = useSettledViewer();
  const [tab, setTab] = useState<Tab>("all");

  // isPending rather than isLoading: while waiting for the session the query
  // is disabled, and a disabled query is not "loading", which would flash
  // "No work posted yet" at someone whose feed is about to arrive.
  const { data, isPending: isLoading, error, refetch } = useQuery({
    queryKey: ["feed", tab, viewer.key],
    queryFn: () => (tab === "saved" ? savedFeed() : homeFeed()),
    enabled: viewer.ready,
  });

  const items = data?.items ?? [];

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex gap-1 rounded-md border border-fiber bg-paper-raised p-1">
            {(["all", "saved"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                aria-pressed={tab === value}
                className={cx(
                  "press rounded-sm px-3 py-1.5 text-sm transition-colors",
                  tab === value
                    ? "bg-indigo text-paper-raised"
                    : "text-ink-soft hover:text-ink",
                )}
              >
                {value === "all" ? "For you" : "Saved"}
              </button>
            ))}
          </div>

          {user?.role === "artist" && (
            <ButtonLink to="/posts/new" size="sm">
              Share your work
            </ButtonLink>
          )}
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <div className="space-y-5">
            <CardSkeleton count={3} />
          </div>
        ) : items.length === 0 ? (
          tab === "saved" ? (
            <EmptyState
              title="Nothing saved yet"
              description="Use the bookmark on a post to keep it here. It is private to you."
              action={{ label: "Browse recent work", to: "/discover" }}
            />
          ) : (
            <EmptyState
              title="Nothing here yet"
              description="Work that artists share and requests that clients post appear here."
              action={{ label: "Browse craft requests", to: "/postings" }}
            />
          )
        ) : (
          <ul className="stagger space-y-5">
            {items.map((item) =>
              item.kind === "request" ? (
                <li key={`request-${item.id}`}>
                  <FeedRequestCard request={item} />
                </li>
              ) : (
                <li key={item.share?.id ?? item.id}>
                  <FeedPost post={item} />
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      {/* Sticky on desktop so the marketplace stays reachable while reading. */}
      <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <OpenRequests />
        <CategoryList />
      </aside>
    </div>
  );
}
