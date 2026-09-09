import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LIMITS,
  formatPeso,
  type ApplicationDto,
  type ArtistPostDto,
  type Paginated,
  type PostingDto,
} from "@raxtan/shared";
import { ApiError, api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { cx } from "../lib/cx.js";
import { Page } from "../components/layout/Shell.js";
import { Button, ButtonLink } from "../components/ui/Button.js";
import { Field, PesoInput, TextArea } from "../components/ui/Field.js";
import {
  Card,
  ImageFrame,
  Money,
  StatusBadge,
  ThreadRule,
  UserChip,
} from "../components/ui/Primitives.js";
import { ErrorState, FormError, RowSkeleton } from "../components/ui/States.js";

function Gallery({ posting }: { posting: PostingDto }) {
  const [active, setActive] = useState(0);
  if (posting.images.length === 0) return null;

  const current = posting.images[active] ?? posting.images[0]!;

  return (
    <div className="space-y-3">
      <img
        src={current.url}
        alt={`Reference image ${active + 1} for ${posting.title}`}
        className="w-full rounded-md border border-fiber bg-paper-sunk object-cover"
        style={{ aspectRatio: "3 / 2" }}
      />
      {posting.images.length > 1 && (
        <ul className="flex flex-wrap gap-2">
          {posting.images.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Show reference image ${index + 1}`}
                aria-current={index === active}
                className={cx(
                  "block overflow-hidden rounded-sm border-2 transition-colors",
                  index === active ? "border-indigo" : "border-transparent hover:border-fiber-strong",
                )}
              >
                <img src={image.url} alt="" className="size-16 object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BidSentCard() {
  return (
    <Card className="p-6">
      <div className="pl-3">
        <h2 className="font-display text-xl">Your bid is in</h2>
        <p className="mt-2 text-ink-soft">
          The client can now see your price, your message and your portfolio.
          You will be notified when they decide.
        </p>
        <div className="mt-4">
          <ButtonLink to="/my/applications" variant="secondary" size="sm">
            See my bids
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}

function ApplyForm({
  posting,
  onSubmitted,
}: {
  posting: PostingDto;
  onSubmitted: () => void;
}) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState<number | "">(posting.minBudgetCentavos);
  const [coverLetter, setCoverLetter] = useState("");
  const [samples, setSamples] = useState<string[]>([]);

  const { user } = useAuth();

  const { data: myPosts } = useQuery({
    queryKey: ["posts", "mine", user?.username],
    queryFn: () =>
      api.get<Paginated<ArtistPostDto>>(`/posts?artist=${user!.username}&limit=12`),
    enabled: Boolean(user),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ApplicationDto>(`/postings/${posting.id}/applications`, {
        proposedPriceCentavos: price === "" ? 0 : price,
        coverLetter,
        samplePostIds: samples,
      }),
    onSuccess: () => {
      // The parent owns the confirmation. Refetching the posting flips
      // `canApply` to false, which would unmount this form: if the success
      // message lived here it would vanish the instant it appeared, and the
      // artist would see "you have already bid" as their only feedback.
      onSubmitted();
      void queryClient.invalidateQueries({ queryKey: ["posting", posting.id] });
    },
  });

  const fields = mutation.error instanceof ApiError ? mutation.error.fields : {};
  const belowMinimum = price !== "" && price < posting.minBudgetCentavos;

  return (
    <Card className="p-6">
      <div className="space-y-5 pl-3">
        <div>
          <h2 className="font-display text-xl">Bid on this request</h2>
          <p className="mt-1 text-sm text-ink-soft">
            The client is starting at {formatPeso(posting.minBudgetCentavos)}. Bid
            that or more, based on what the work will actually take.
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

          <Field
            label="Your price"
            hint={`Minimum ${formatPeso(posting.minBudgetCentavos)}`}
            error={
              belowMinimum
                ? `Your price cannot be below ${formatPeso(posting.minBudgetCentavos)}.`
                : fields.proposedPriceCentavos
            }
            required
          >
            {({ id, describedBy, invalid }) => (
              <PesoInput
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                valueCentavos={price}
                onChangeCentavos={setPrice}
              />
            )}
          </Field>

          <Field
            label="Message to the client"
            hint="Say how you would make this, what materials you would use, and how long it would take."
            error={fields.coverLetter}
            required
          >
            {({ id, describedBy, invalid }) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={coverLetter}
                onChange={(event) => setCoverLetter(event.target.value)}
                maxLength={LIMITS.coverLetter.max}
                rows={6}
                required
              />
            )}
          </Field>

          {myPosts && myPosts.items.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink">
                Attach work samples
              </legend>
              <p className="mb-3 text-sm text-ink-faint">
                Pick up to {LIMITS.applicationSamples.max} pieces from your
                portfolio that show you can make this.
              </p>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {myPosts.items.map((post) => {
                  const selected = samples.includes(post.id);
                  return (
                    <li key={post.id}>
                      <label
                        className={cx(
                          "block cursor-pointer overflow-hidden rounded-md border-2 transition-colors",
                          selected ? "border-indigo" : "border-transparent hover:border-fiber-strong",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selected}
                          onChange={() =>
                            setSamples((current) =>
                              selected
                                ? current.filter((id) => id !== post.id)
                                : current.length < LIMITS.applicationSamples.max
                                  ? [...current, post.id]
                                  : current,
                            )
                          }
                        />
                        <ImageFrame
                          image={post.coverImage}
                          alt={post.caption}
                          aspect="1 / 1"
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          <Button
            type="submit"
            size="lg"
            loading={mutation.isPending}
            disabled={belowMinimum}
          >
            Send bid
          </Button>
        </form>
      </div>
    </Card>
  );
}

export function PostingDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Survives the refetch that follows a successful bid, so the confirmation
  // stays on screen instead of being replaced a moment after it appears.
  const [justBid, setJustBid] = useState(false);

  const { data: posting, isLoading, error, refetch } = useQuery({
    queryKey: ["posting", id],
    queryFn: () => api.get<PostingDto>(`/postings/${id}`),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post<PostingDto>(`/postings/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["posting", id] }),
  });

  if (isLoading) {
    return (
      <Page>
        <div className="space-y-4">
          <RowSkeleton count={3} />
        </div>
      </Page>
    );
  }

  if (error || !posting) {
    return (
      <Page>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Page>
    );
  }

  const isOwner = user?.id === posting.client.id;
  const isArtist = user?.role === "artist";
  const canApply = isArtist && posting.status === "open" && !posting.viewerApplicationId;

  return (
    <Page>
      <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="eyebrow">{posting.category.name}</span>
              <StatusBadge status={posting.status} />
            </div>
            <h1 className="mt-3 font-display text-3xl sm:text-4xl">{posting.title}</h1>
            <ThreadRule className="mt-5 w-20" />
          </div>

          <Gallery posting={posting} />

          <section>
            <h2 className="eyebrow mb-3">What the client wants</h2>
            <p className="whitespace-pre-wrap leading-relaxed text-ink-soft">
              {posting.description}
            </p>
          </section>

          {posting.requirements && (
            <section>
              <h2 className="eyebrow mb-3">Additional requirements</h2>
              <p className="whitespace-pre-wrap leading-relaxed text-ink-soft">
                {posting.requirements}
              </p>
            </section>
          )}

          {justBid && <BidSentCard />}

          {!justBid && canApply && (
            <ApplyForm posting={posting} onSubmitted={() => setJustBid(true)} />
          )}

          {!justBid && isArtist && posting.viewerApplicationId && (
            <Card className="p-5">
              <div className="pl-3">
                <h2 className="font-display text-lg">You have already bid on this</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Each artist gets one bid per request, so it stays a fair
                  comparison for the client.
                </p>
                <div className="mt-3">
                  <ButtonLink to="/my/applications" variant="secondary" size="sm">
                    See my bids
                  </ButtonLink>
                </div>
              </div>
            </Card>
          )}

          {isArtist && posting.status !== "open" && !posting.viewerApplicationId && (
            <Card className="p-5">
              <p className="pl-3 text-ink-soft">
                This request is no longer accepting bids.
              </p>
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card className="p-5">
            <div className="pl-3">
              <span className="eyebrow block">Starting budget</span>
              <Money centavos={posting.minBudgetCentavos} size="lg" className="mt-1 block" />
              <p className="mt-2 text-sm text-ink-faint">
                Bids must be at or above this amount.
              </p>

              <div className="mt-5 border-t border-fiber pt-4">
                <span className="eyebrow mb-2 block">Posted by</span>
                <UserChip user={posting.client} size={36} />
              </div>

              <dl className="mt-5 space-y-2 border-t border-fiber pt-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">Bids</dt>
                  <dd className="tabular font-medium">{posting.applicationCount}</dd>
                </div>
                {posting.deadline && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-faint">Wanted by</dt>
                    <dd className="font-medium">
                      {new Date(posting.deadline).toLocaleDateString("en-PH", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">Posted</dt>
                  <dd className="font-medium">
                    {new Date(posting.createdAt).toLocaleDateString("en-PH", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </dd>
                </div>
              </dl>
            </div>
          </Card>

          {isOwner && (
            <Card className="p-5">
              <div className="space-y-3 pl-3">
                <h2 className="font-display text-lg">Manage this request</h2>
                <ButtonLink
                  to={`/postings/${posting.id}/applications`}
                  className="w-full"
                  size="sm"
                >
                  Review {posting.applicationCount} bid
                  {posting.applicationCount === 1 ? "" : "s"}
                </ButtonLink>

                {posting.status === "open" && (
                  <>
                    <ButtonLink
                      to={`/postings/${posting.id}/edit`}
                      variant="secondary"
                      size="sm"
                      className="w-full"
                    >
                      Edit request
                    </ButtonLink>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      loading={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate()}
                    >
                      Cancel request
                    </Button>
                  </>
                )}

                {posting.commissionId && (
                  <ButtonLink
                    to={`/commissions/${posting.commissionId}`}
                    variant="secondary"
                    size="sm"
                    className="w-full"
                  >
                    Open commission
                  </ButtonLink>
                )}
              </div>
            </Card>
          )}

          {!user && (
            <Card className="p-5">
              <div className="pl-3">
                <p className="text-sm text-ink-soft">
                  Sign in as an artist to bid on this request.
                </p>
                <div className="mt-3 flex gap-2">
                  <ButtonLink to="/login" size="sm" variant="secondary">
                    Sign in
                  </ButtonLink>
                  <ButtonLink to="/register?role=artist" size="sm">
                    Join as artist
                  </ButtonLink>
                </div>
              </div>
            </Card>
          )}
        </aside>
      </div>

      <p className="mt-12 text-sm text-ink-faint">
        <Link to="/postings" className="hover:text-ink hover:underline">
          Back to all craft requests
        </Link>
      </p>
    </Page>
  );
}
