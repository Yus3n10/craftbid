import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Paginated, PostingDto } from "@raxtan/shared";
import { api } from "../lib/api.js";
import { Page } from "../components/layout/Shell.js";
import { ButtonLink } from "../components/ui/Button.js";
import { Card, Money, StatusBadge } from "../components/ui/Primitives.js";
import {
  EmptyState,
  ErrorState,
  PageHeading,
  RowSkeleton,
} from "../components/ui/States.js";

export function MyPostingsPage() {

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["postings", "mine"],
    // `mine` is resolved from the session on the server; no client id is sent.
    queryFn: () => api.get<Paginated<PostingDto>>("/postings?limit=50&mine=true"),
  });

  const mine = data?.items ?? [];

  return (
    <Page>
      <PageHeading
        eyebrow="Client"
        title="My craft requests"
        description="Everything you have posted, and where each one stands."
        actions={<ButtonLink to="/postings/new">Post a request</ButtonLink>}
      />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">
          <RowSkeleton count={3} />
        </div>
      ) : mine.length === 0 ? (
        <EmptyState
          title="You have not posted anything yet"
          description="Describe what you want made and set a starting budget. Artists in that craft can then bid on it."
          action={{ label: "Post your first request", to: "/postings/new" }}
        />
      ) : (
        <ul className="space-y-3">
          {mine.map((posting) => (
            <li key={posting.id}>
              <Card categorySlug={posting.category.slug} interactive className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-4 pl-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="eyebrow">{posting.category.name}</span>
                      <StatusBadge status={posting.status} />
                    </div>
                    <h2 className="truncate font-display text-lg">
                      <Link to={`/postings/${posting.id}`} className="hover:underline">
                        {posting.title}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-ink-faint">
                      {posting.applicationCount === 0
                        ? "No bids yet"
                        : `${posting.applicationCount} bid${posting.applicationCount === 1 ? "" : "s"}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <Money centavos={posting.minBudgetCentavos} />
                    <ButtonLink
                      to={`/postings/${posting.id}/applications`}
                      variant="secondary"
                      size="sm"
                    >
                      Review bids
                    </ButtonLink>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
