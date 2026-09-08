import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { CommissionDto, Paginated } from "@raxtan/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { Page } from "../components/layout/Shell.js";
import { Card, Money, StatusBadge, UserChip } from "../components/ui/Primitives.js";
import {
  EmptyState,
  ErrorState,
  PageHeading,
  RowSkeleton,
} from "../components/ui/States.js";

export function CommissionsPage() {
  const { user } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["commissions"],
    queryFn: () => api.get<Paginated<CommissionDto>>("/commissions?limit=50"),
  });

  const isClient = user?.role === "client";

  return (
    <Page>
      <PageHeading
        eyebrow={isClient ? "Client" : "Artist"}
        title="Commissions"
        description="Work that has been agreed. Once a piece is finished and marked complete, both sides can leave a review."
      />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">
          <RowSkeleton count={3} />
        </div>
      ) : data?.items.length === 0 ? (
        <EmptyState
          title="No commissions yet"
          description={
            isClient
              ? "When you choose an artist for one of your requests, the commission appears here."
              : "When a client picks your bid, the commission appears here."
          }
          action={
            isClient
              ? { label: "Post a request", to: "/postings/new" }
              : { label: "Find commissions", to: "/postings" }
          }
        />
      ) : (
        <ul className="space-y-3">
          {data?.items.map((commission) => (
            <li key={commission.id}>
              <Card interactive className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-4 pl-3">
                  <div className="min-w-0">
                    <StatusBadge status={commission.status} />
                    <h2 className="mt-2 truncate font-display text-lg">
                      <Link
                        to={`/commissions/${commission.id}`}
                        className="hover:underline"
                      >
                        {commission.posting.title}
                      </Link>
                    </h2>
                    <div className="mt-2">
                      <UserChip
                        user={isClient ? commission.artist : commission.client}
                        size={26}
                        subtitle={isClient ? "Artist" : "Client"}
                      />
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="eyebrow block">Agreed</span>
                    <Money centavos={commission.agreedPriceCentavos} />
                    {commission.canReview && (
                      <p className="mt-1 text-xs font-medium text-clay">
                        Review waiting
                      </p>
                    )}
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
