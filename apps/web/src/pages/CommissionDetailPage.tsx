import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LIMITS, type CommissionDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { cx } from "../lib/cx.js";
import { Page } from "../components/layout/Shell.js";
import { Button, ButtonLink } from "../components/ui/Button.js";
import { StarPicker, Stars } from "../components/ui/Stars.js";
import { Field, TextArea } from "../components/ui/Field.js";
import {
  Avatar,
  Card,
  Money,
  StatusBadge,
  ThreadRule,
  UserChip,
} from "../components/ui/Primitives.js";
import { ErrorState, FormError, RowSkeleton } from "../components/ui/States.js";

function ReviewForm({ commission }: { commission: CommissionDto }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/commissions/${commission.id}/reviews`, {
        rating,
        ...(body ? { body } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["commission", commission.id] });
      void queryClient.invalidateQueries({ queryKey: ["commissions"] });
    },
  });

  return (
    <Card className="p-6">
      <div className="space-y-5 pl-3">
        <div>
          <h2 className="font-display text-xl">Leave a review</h2>
          <p className="mt-1 text-sm text-ink-soft">
            This is public and permanent. Reviews cannot be edited or deleted
            once written, which is what makes them worth reading.
          </p>
        </div>

        <form
          className="space-y-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FormError error={mutation.error} />

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">Rating</legend>
            <div className="text-3xl leading-none">
              <StarPicker value={rating} onChange={setRating} />
            </div>
          </fieldset>

          <Field label="What was it like to work together?" hint="Optional.">
            {({ id, describedBy }) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={LIMITS.reviewBody.max}
                rows={5}
              />
            )}
          </Field>

          <Button type="submit" loading={mutation.isPending} disabled={rating === 0}>
            Publish review
          </Button>
        </form>
      </div>
    </Card>
  );
}

export function CommissionDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: commission, isLoading, error, refetch } = useQuery({
    queryKey: ["commission", id],
    queryFn: () => api.get<CommissionDto>(`/commissions/${id}`),
  });

  const complete = useMutation({
    mutationFn: () => api.post<CommissionDto>(`/commissions/${id}/complete`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["commission", id] });
      void queryClient.invalidateQueries({ queryKey: ["commissions"] });
    },
  });

  if (isLoading) {
    return (
      <Page>
        <RowSkeleton count={3} />
      </Page>
    );
  }

  if (error || !commission) {
    return (
      <Page>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Page>
    );
  }

  const isClient = user?.id === commission.client.id;

  return (
    <Page>
      <div className="grid gap-10 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-8">
          <div>
            <StatusBadge status={commission.status} />
            <h1 className="mt-3 font-display text-3xl">{commission.posting.title}</h1>
            <ThreadRule className="mt-5 w-20" />
          </div>

          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-8 pl-3">
              <div>
                <span className="eyebrow block">Client</span>
                <div className="mt-1">
                  <UserChip user={commission.client} size={32} />
                </div>
              </div>
              <div>
                <span className="eyebrow block">Artist</span>
                <div className="mt-1">
                  <UserChip user={commission.artist} size={32} />
                </div>
              </div>
            </div>
          </Card>

          {commission.status === "active" && (
            <Card className="p-5">
              <div className="pl-3">
                <h2 className="font-display text-lg">
                  {isClient ? "When the piece arrives" : "While you make it"}
                </h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {isClient
                    ? "Arrange delivery and payment with the artist directly. Once you have the piece, mark this complete so you can both leave reviews."
                    : "Arrange delivery and payment with the client directly. They will mark this complete once the piece arrives, and you can both leave reviews."}
                </p>
                {isClient && (
                  <div className="mt-4">
                    <Button loading={complete.isPending} onClick={() => complete.mutate()}>
                      Mark as complete
                    </Button>
                  </div>
                )}
                <FormError error={complete.error} />
              </div>
            </Card>
          )}

          {commission.canReview && <ReviewForm commission={commission} />}

          {commission.reviews.length > 0 && (
            <section>
              <h2 className="font-display text-2xl">Reviews</h2>
              <ThreadRule className="mt-3 w-16" />
              <ul className="mt-5 space-y-4">
                {commission.reviews.map((review) => (
                  <li key={review.id}>
                    <Card className="p-5">
                      <div className="pl-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar user={review.reviewer} size={32} />
                            <span className="text-sm font-medium">
                              {review.reviewer.displayName}
                            </span>
                          </div>
                          <Stars value={review.rating} />
                        </div>
                        {review.body && (
                          <p className="mt-3 whitespace-pre-wrap text-sm text-ink-soft">
                            {review.body}
                          </p>
                        )}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside>
          <Card className="p-5">
            <div className="pl-3">
              <span className="eyebrow block">Agreed price</span>
              <Money centavos={commission.agreedPriceCentavos} size="lg" className="mt-1 block" />
              <p className="mt-2 text-sm text-ink-faint">
                Craftbid does not handle payment. Settle directly with each other.
              </p>

              <dl className="mt-5 space-y-2 border-t border-fiber pt-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">Started</dt>
                  <dd className="font-medium">
                    {new Date(commission.startedAt).toLocaleDateString("en-PH", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </dd>
                </div>
                {commission.completedAt && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-faint">Completed</dt>
                    <dd className="font-medium">
                      {new Date(commission.completedAt).toLocaleDateString("en-PH", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="mt-5 border-t border-fiber pt-4">
                <ButtonLink
                  to={`/postings/${commission.posting.id}`}
                  variant="secondary"
                  size="sm"
                  className="w-full"
                >
                  View original request
                </ButtonLink>
              </div>
            </div>
          </Card>
        </aside>
      </div>

      <p className="mt-12 text-sm text-ink-faint">
        <Link to="/commissions" className="hover:text-ink hover:underline">
          Back to commissions
        </Link>
      </p>
    </Page>
  );
}
