import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CRAFT_CATEGORIES, type Paginated, type PostingDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { Page } from "../components/layout/Shell.js";
import { Select, TextInput } from "../components/ui/Field.js";
import { ButtonLink } from "../components/ui/Button.js";
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  PageHeading,
  Pagination,
} from "../components/ui/States.js";
import { PostingCard } from "../components/PostingCard.js";

const LIMIT = 12;

export function PostingsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const category = params.get("category") ?? "";
  const sort = params.get("sort") ?? "newest";
  const status = params.get("status") ?? "open";
  const q = params.get("q") ?? "";
  const offset = Number(params.get("offset") ?? 0);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change invalidates the current page.
    if (key !== "offset") next.delete("offset");
    setParams(next, { replace: true });
  }

  const query = new URLSearchParams({
    limit: String(LIMIT),
    offset: String(offset),
    sort,
  });
  if (category) query.set("category", category);
  if (status) query.set("status", status);
  if (q) query.set("q", q);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["postings", query.toString()],
    queryFn: () => api.get<Paginated<PostingDto>>(`/postings?${query.toString()}`),
  });

  const filtered = Boolean(category || q || status !== "open");

  return (
    <Page>
      <PageHeading
        eyebrow="For artists"
        title="Craft requests"
        description="Open commissions from clients looking for handmade work. Bid at or above the starting budget."
        actions={
          user?.role === "client" ? (
            <ButtonLink to="/postings/new">Post a request</ButtonLink>
          ) : undefined
        }
      />

      <form
        className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="lg:col-span-2">
          <span className="sr-only">Search requests</span>
          <TextInput
            type="search"
            placeholder="Search requests"
            defaultValue={q}
            onChange={(event) => setParam("q", event.target.value)}
          />
        </label>

        <label>
          <span className="sr-only">Craft category</span>
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

        <label>
          <span className="sr-only">Sort by</span>
          <Select value={sort} onChange={(event) => setParam("sort", event.target.value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="budget_high">Highest budget</option>
            <option value="budget_low">Lowest budget</option>
          </Select>
        </label>
      </form>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {isLoading ? (
              <CardSkeleton count={6} />
            ) : (
              data?.items.map((posting) => (
                <PostingCard key={posting.id} posting={posting} />
              ))
            )}
          </div>

          {!isLoading && data?.items.length === 0 && (
            <EmptyState
              title={filtered ? "No requests match those filters" : "No open requests yet"}
              description={
                filtered
                  ? "Try a different craft or clear the search to see everything that is open."
                  : "Nobody has posted a craft request so far. Check back, or be the first to post one."
              }
              action={
                filtered
                  ? { label: "Clear filters", to: "/postings" }
                  : { label: "Post a craft request", to: "/postings/new" }
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
