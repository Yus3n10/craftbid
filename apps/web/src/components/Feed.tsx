import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CRAFT_CATEGORIES,
  formatPeso,
  type ArtistPostDto,
  type Paginated,
  type PostingDto,
} from "@craftbid/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { cx } from "../lib/cx.js";
import { materialColor } from "../lib/materials.js";
import { ButtonLink } from "./ui/Button.js";
import { Card, ThreadRule } from "./ui/Primitives.js";
import { CardSkeleton, EmptyState, ErrorState } from "./ui/States.js";
import { FeedPost } from "./FeedPost.js";

type Tab = "all" | "saved";

/**
 * Open craft requests, alongside the feed rather than inside it.
 *
 * A request is the start of a private negotiation and a post is public work.
 * Mixing them into one column would invite people to react to a request the
 * way they react to a photograph, and the whole point is that bidding stays
 * between the client and each artist separately.
 */
function OpenRequests() {
  const { data, isLoading } = useQuery({
    queryKey: ["postings", "sidebar"],
    queryFn: () =>
      api.get<Paginated<PostingDto>>("/postings?status=open&limit=4&sort=newest"),
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
 * The feed.
 *
 * One column of work at a readable width with the marketplace alongside it,
 * rather than a grid. A grid is right for browsing many things quickly and
 * wrong for looking at any of them, and looking is what turns a reader into
 * someone who commissions.
 */
export function Feed() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("all");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["feed", tab],
    queryFn: () =>
      api.get<Paginated<ArtistPostDto>>(
        `/feed?limit=12${tab === "saved" ? "&saved=true" : ""}`,
      ),
  });

  const posts = data?.items ?? [];

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
                {value === "all" ? "Recent work" : "Saved"}
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
        ) : posts.length === 0 ? (
          tab === "saved" ? (
            <EmptyState
              title="Nothing saved yet"
              description="Use the bookmark on a post to keep it here. It is private to you."
              action={{ label: "Browse recent work", to: "/discover" }}
            />
          ) : (
            <EmptyState
              title="No work posted yet"
              description="When artists share pieces they have finished, they appear here."
              action={{ label: "Browse craft requests", to: "/postings" }}
            />
          )
        ) : (
          <ul className="stagger space-y-5">
            {posts.map((post) => (
              <li key={post.id}>
                <FeedPost post={post} />
              </li>
            ))}
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
