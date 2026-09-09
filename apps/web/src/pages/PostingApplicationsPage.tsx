import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApplicationDto, Paginated, PostingDto } from "@craftbid/shared";
import { formatPeso } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { Page } from "../components/layout/Shell.js";
import { Button, ButtonLink } from "../components/ui/Button.js";
import {
  Card,
  ImageFrame,
  Money,
  StatusBadge,
  UserChip,
} from "../components/ui/Primitives.js";
import {
  EmptyState,
  ErrorState,
  FormError,
  PageHeading,
  RowSkeleton,
} from "../components/ui/States.js";

function Stars({ average, count }: { average: number | null; count: number }) {
  if (count === 0) {
    return <span className="text-xs text-ink-faint">No reviews yet</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-soft">
      <span aria-hidden="true" className="text-amber">
        {"★".repeat(Math.round(average ?? 0)).padEnd(5, "☆")}
      </span>
      <span className="tabular">
        {average?.toFixed(1)} ({count})
      </span>
    </span>
  );
}

function ApplicationRow({
  application,
  postingOpen,
}: {
  application: ApplicationDto;
  postingOpen: boolean;
}) {
  const queryClient = useQueryClient();

  const decide = useMutation({
    mutationFn: (action: "accept" | "reject") =>
      api.post<ApplicationDto>(`/applications/${application.id}/${action}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
      void queryClient.invalidateQueries({ queryKey: ["posting"] });
    },
  });

  return (
    <Card className="p-5">
      <div className="space-y-4 pl-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <UserChip user={application.artist} size={40} />
            <Stars
              average={application.artistRating.average}
              count={application.artistRating.count}
            />
          </div>

          <div className="text-right">
            <span className="eyebrow block">Their price</span>
            <Money centavos={application.proposedPriceCentavos} size="lg" />
            <div className="mt-1">
              <StatusBadge status={application.status} />
            </div>
          </div>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
          {application.coverLetter}
        </p>

        {application.samples.length > 0 && (
          <div>
            <h3 className="eyebrow mb-2">Work samples</h3>
            <ul className="flex flex-wrap gap-2">
              {application.samples.map((sample) => (
                <li key={sample.id} className="w-20">
                  <ImageFrame
                    image={sample.coverImage}
                    alt={sample.caption}
                    aspect="1 / 1"
                    className="rounded-sm border border-fiber"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        <FormError error={decide.error} />

        <div className="flex flex-wrap gap-2 border-t border-fiber pt-4">
          <ButtonLink
            to={`/artists/${application.artist.username}`}
            variant="secondary"
            size="sm"
          >
            View portfolio
          </ButtonLink>

          {postingOpen && application.status === "pending" && (
            <>
              <Button
                size="sm"
                loading={decide.isPending && decide.variables === "accept"}
                onClick={() => decide.mutate("accept")}
              >
                Choose this artist
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={decide.isPending && decide.variables === "reject"}
                onClick={() => decide.mutate("reject")}
              >
                Decline
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export function PostingApplicationsPage() {
  const { id = "" } = useParams();

  const posting = useQuery({
    queryKey: ["posting", id],
    queryFn: () => api.get<PostingDto>(`/postings/${id}`),
  });

  const applications = useQuery({
    queryKey: ["applications", "posting", id],
    queryFn: () =>
      api.get<Paginated<ApplicationDto>>(`/postings/${id}/applications?limit=50`),
  });

  if (posting.isLoading || applications.isLoading) {
    return (
      <Page>
        <RowSkeleton count={3} />
      </Page>
    );
  }

  if (posting.error || applications.error) {
    return (
      <Page>
        <ErrorState
          error={posting.error ?? applications.error}
          onRetry={() => {
            void posting.refetch();
            void applications.refetch();
          }}
        />
      </Page>
    );
  }

  const items = applications.data?.items ?? [];
  const open = posting.data?.status === "open";
  const accepted = items.find((item) => item.status === "accepted");

  return (
    <Page>
      <PageHeading
        eyebrow="Reviewing bids"
        title={posting.data?.title ?? "Bids"}
        description={
          open
            ? `Compare what each artist would charge and how they would make it. Starting budget ${formatPeso(posting.data?.minBudgetCentavos ?? 0)}.`
            : "This request is closed. The bids below are kept for your records."
        }
        actions={
          <ButtonLink to={`/postings/${id}`} variant="secondary">
            View request
          </ButtonLink>
        }
      />

      {accepted && (
        <Card className="mb-6 p-5" categorySlug={posting.data?.category.slug}>
          <div className="pl-3">
            <h2 className="font-display text-lg">
              You chose {accepted.artist.displayName}
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Agreed at {formatPeso(accepted.proposedPriceCentavos)}. Arrange the
              details directly, then mark the commission complete when the piece
              arrives.
            </p>
            {posting.data?.commissionId && (
              <div className="mt-3">
                <ButtonLink to={`/commissions/${posting.data.commissionId}`} size="sm">
                  Open commission
                </ButtonLink>
              </div>
            )}
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No bids yet"
          description="Artists have not found this request yet. Requests with reference images and a clear description tend to get bids sooner."
          action={{ label: "Edit your request", to: `/postings/${id}/edit` }}
        />
      ) : (
        <ul className="space-y-4">
          {items.map((application) => (
            <li key={application.id}>
              <ApplicationRow application={application} postingOpen={open} />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-10 text-sm text-ink-faint">
        <Link to="/my/postings" className="hover:text-ink hover:underline">
          Back to my requests
        </Link>
      </p>
    </Page>
  );
}
