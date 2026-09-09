import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CRAFT_CATEGORIES, type ArtistPostDto, type Paginated } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { Page } from "../components/layout/Shell.js";
import { ButtonLink } from "../components/ui/Button.js";
import { Select } from "../components/ui/Field.js";
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  PageHeading,
  Pagination,
} from "../components/ui/States.js";
import { PostCard } from "../components/PostCard.js";

const LIMIT = 16;

export function DiscoverPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const category = params.get("category") ?? "";
  const offset = Number(params.get("offset") ?? 0);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "offset") next.delete("offset");
    setParams(next, { replace: true });
  }

  const query = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
  if (category) query.set("category", category);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["posts", query.toString()],
    queryFn: () => api.get<Paginated<ArtistPostDto>>(`/posts?${query.toString()}`),
  });

  return (
    <Page>
      <PageHeading
        eyebrow="For clients"
        title="Discover work"
        description="Pieces made by artists on Craftbid. Find someone whose hand you like, then invite them to bid on your request."
        actions={
          user?.role === "artist" ? (
            <ButtonLink to="/posts/new">Add to portfolio</ButtonLink>
          ) : undefined
        }
      />

      <div className="mb-8 max-w-xs">
        <label>
          <span className="sr-only">Filter by craft</span>
          <Select
            value={category}
            onChange={(event) => setParam("category", event.target.value)}
          >
            <option value="">All crafts</option>
            {CRAFT_CATEGORIES.map((option) => (
              <option key={option.slug} value={option.slug}>
                {option.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {isLoading ? (
              <CardSkeleton count={8} />
            ) : (
              data?.items.map((post) => <PostCard key={post.id} post={post} />)
            )}
          </div>

          {!isLoading && data?.items.length === 0 && (
            <EmptyState
              title={category ? "No work in this craft yet" : "No work posted yet"}
              description={
                category
                  ? "No artist has shared a piece in this craft so far. Try another, or browse everything."
                  : "Artists have not shared any pieces yet. If you make things, your portfolio would be the first here."
              }
              action={
                category
                  ? { label: "Browse all crafts", to: "/discover" }
                  : { label: "Join as an artist", to: "/register?role=artist" }
              }
            />
          )}

          {data && (
            <Pagination
              total={data.total}
              limit={LIMIT}
              offset={offset}
              onChange={(next) => setParam("offset", String(next))}
            />
          )}
        </>
      )}
    </Page>
  );
}
