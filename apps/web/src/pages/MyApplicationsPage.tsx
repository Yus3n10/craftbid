import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApplicationDto, Paginated } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { Page } from "../components/layout/Shell.js";
import { Button } from "../components/ui/Button.js";
import { Card, Money, StatusBadge } from "../components/ui/Primitives.js";
import {
  EmptyState,
  ErrorState,
  PageHeading,
  RowSkeleton,
} from "../components/ui/States.js";

export function MyApplicationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["applications", "mine"],
    queryFn: () => api.get<Paginated<ApplicationDto>>("/applications/mine?limit=50"),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => api.post<ApplicationDto>(`/applications/${id}/withdraw`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["applications"] }),
  });

  return (
    <Page>
      <PageHeading
        eyebrow="Artist"
        title="My bids"
        description="Every request you have bid on, and how each one went."
      />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">
          <RowSkeleton count={3} />
        </div>
      ) : data?.items.length === 0 ? (
        <EmptyState
          title="You have not bid on anything yet"
          description="Browse open craft requests and bid on the ones that suit your hands. You can bid at or above the client's starting budget."
          action={{ label: "Find commissions", to: "/postings" }}
        />
      ) : (
        <ul className="space-y-3">
          {data?.items.map((application) => (
            <li key={application.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-4 pl-3">
                  <div className="min-w-0">
                    <StatusBadge status={application.status} />
                    <p className="mt-2 line-clamp-2 text-sm text-ink-soft">
                      {application.coverLetter}
                    </p>
                    <Link
                      to={`/postings/${application.postingId}`}
                      className="mt-2 inline-block text-sm font-medium text-indigo hover:underline"
                    >
                      View the request
                    </Link>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="eyebrow block">Your price</span>
                      <Money centavos={application.proposedPriceCentavos} />
                    </div>
                    {application.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={withdraw.isPending && withdraw.variables === application.id}
                        onClick={() => withdraw.mutate(application.id)}
                      >
                        Withdraw
                      </Button>
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
