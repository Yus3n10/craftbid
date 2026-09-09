import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ArtistPostDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { Page } from "../components/layout/Shell.js";
import { ErrorState, RowSkeleton } from "../components/ui/States.js";
import { FeedPost } from "../components/FeedPost.js";

/**
 * A single piece of work on its own page.
 *
 * This is where a shared link lands, so it is the same card the feed shows
 * rather than a separate layout: someone arriving from a link should see what
 * the person who sent it saw.
 */
export function PostDetailPage() {
  const { id = "" } = useParams();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["post", id],
    queryFn: () => api.get<ArtistPostDto>(`/posts/${id}`),
  });

  if (isLoading) {
    return (
      <Page width="narrow">
        <RowSkeleton count={3} />
      </Page>
    );
  }

  if (error || !data) {
    return (
      <Page width="narrow">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Page>
    );
  }

  return (
    <Page width="narrow">
      <FeedPost post={data} />
      <p className="mt-8 text-sm text-ink-faint">
        <Link to="/discover" className="hover:text-ink hover:underline">
          Discover more work
        </Link>
      </p>
    </Page>
  );
}
