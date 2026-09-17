import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeedItemDto, Paginated } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { Page } from "../components/layout/Shell.js";
import { FeedPost } from "../components/FeedPost.js";
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  PageHeading,
  Pagination,
} from "../components/ui/States.js";

const LIMIT = 12;

/**
 * Posts this person saved, most recently saved first.
 *
 * Linked from the account menu, the phone menu, and the note that appears the
 * moment something is saved.
 */
export function SavedPostsPage() {
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["feed", "saved", offset],
    queryFn: () => api.get<Paginated<FeedItemDto>>(`/feed?saved=true&limit=${LIMIT}&offset=${offset}`),
  });

  return (
    <Page width="narrow">
      <PageHeading
        eyebrow="Your account"
        title="Saved posts"
        description="Work you bookmarked, newest first. Only you can see this list."
      />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-5">
          <CardSkeleton count={2} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          description="Tap the bookmark on any post to keep it here."
          action={{ label: "Browse recent work", to: "/" }}
        />
      ) : (
        <div className="space-y-5">
          <ul className="space-y-5">
            {data.items.map((post) => (
              <li key={post.id}>
                <FeedPost post={post} />
              </li>
            ))}
          </ul>
          <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </div>
      )}
    </Page>
  );
}
