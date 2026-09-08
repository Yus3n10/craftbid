import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type {
  ArtistPostDto,
  ExternalLinkDto,
  Paginated,
  PublicProfileDto,
  ReviewDto,
} from "@raxtan/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { materialColor } from "../lib/materials.js";
import { Page } from "../components/layout/Shell.js";
import { ButtonLink } from "../components/ui/Button.js";
import { Avatar, Card, Tag, ThreadRule } from "../components/ui/Primitives.js";
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  RowSkeleton,
} from "../components/ui/States.js";
import { PostCard } from "../components/PostCard.js";

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
  pinterest: "Pinterest",
  shopee: "Shopee",
  lazada: "Lazada",
  website: "Website",
  other: "Link",
};

function LinkList({ links }: { links: ExternalLinkDto[] }) {
  if (links.length === 0) return null;
  return (
    <div>
      <h2 className="eyebrow mb-2">Find them elsewhere</h2>
      <ul className="flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={`${link.platform}-${link.url}`}>
            <a
              href={link.url}
              target="_blank"
              // noreferrer and nofollow because these are user-supplied links
              // to sites RaxTan does not vouch for.
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1.5 rounded-sm border border-fiber bg-paper px-2.5 py-1 text-sm text-ink-soft transition-colors hover:border-fiber-strong hover:text-ink"
            >
              {link.label ?? PLATFORM_LABELS[link.platform] ?? link.platform}
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M4 2h6v6M10 2L2.5 9.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RatingSummary({ profile }: { profile: PublicProfileDto }) {
  const { average, count } = profile.rating;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <div>
        <span className="eyebrow block">Rating</span>
        {count === 0 ? (
          <span className="text-ink-faint">No reviews yet</span>
        ) : (
          <span className="flex items-baseline gap-2">
            <span className="tabular font-display text-2xl font-semibold text-ink">
              {average?.toFixed(1)}
            </span>
            <span className="text-sm text-ink-faint">
              from {count} review{count === 1 ? "" : "s"}
            </span>
          </span>
        )}
      </div>
      <div>
        <span className="eyebrow block">Completed</span>
        <span className="tabular font-display text-2xl font-semibold text-ink">
          {profile.completedCommissions}
        </span>
      </div>
    </div>
  );
}

function Reviews({ username }: { username: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["reviews", username],
    queryFn: () => api.get<Paginated<ReviewDto>>(`/users/${username}/reviews?limit=10`),
  });

  if (isLoading) return <RowSkeleton count={2} />;
  if (error) return <ErrorState error={error} />;
  if (!data || data.items.length === 0) {
    return (
      <p className="text-ink-soft">
        No reviews yet. Reviews can only be written after a commission arranged
        through RaxTan is finished, so every one here is from real work.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {data.items.map((review) => (
        <li key={review.id}>
          <Card className="p-5">
            <div className="pl-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Avatar user={review.reviewer} size={32} />
                  <div>
                    <span className="block text-sm font-medium">
                      {review.reviewer.displayName}
                    </span>
                    <span className="block text-xs text-ink-faint">
                      {new Date(review.createdAt).toLocaleDateString("en-PH", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                </div>
                <span className="text-amber" aria-label={`${review.rating} out of 5`}>
                  {"★".repeat(review.rating).padEnd(5, "☆")}
                </span>
              </div>
              {review.body && (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                  {review.body}
                </p>
              )}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Portfolio({ username }: { username: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["posts", "artist", username],
    queryFn: () =>
      api.get<Paginated<ArtistPostDto>>(`/posts?artist=${username}&limit=24`),
  });

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {isLoading ? (
        <CardSkeleton count={3} />
      ) : data && data.items.length > 0 ? (
        data.items.map((post) => <PostCard key={post.id} post={post} />)
      ) : (
        <div className="sm:col-span-2 lg:col-span-3">
          <p className="text-ink-soft">No work posted yet.</p>
        </div>
      )}
    </div>
  );
}

export function ProfilePage() {
  const { username = "" } = useParams();
  const { user } = useAuth();

  const { data: profile, isLoading, error, refetch } = useQuery({
    queryKey: ["profile", username],
    queryFn: () => api.get<PublicProfileDto>(`/users/${username}`),
  });

  if (isLoading) {
    return (
      <Page>
        <RowSkeleton count={3} />
      </Page>
    );
  }

  if (error || !profile) {
    return (
      <Page>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Page>
    );
  }

  const isSelf = user?.id === profile.id;
  const isArtist = profile.role === "artist";
  const location = [profile.city, profile.region].filter(Boolean).join(", ");

  return (
    <>
      {/* Cover. Falls back to a woven band in the artist's primary craft
          colour rather than an empty grey slab. */}
      <div
        className="h-40 border-b border-fiber sm:h-56"
        style={
          profile.cover
            ? {
                backgroundImage: `url(${profile.cover.url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : {
                background: `repeating-linear-gradient(135deg, ${materialColor(
                  profile.artist?.categories[0]?.slug,
                )} 0 2px, transparent 2px 11px), var(--color-paper-sunk)`,
              }
        }
        role="presentation"
      />

      <Page>
        <div className="-mt-16 flex flex-wrap items-end justify-between gap-4 sm:-mt-20">
          <div className="flex items-end gap-4">
            <span className="rounded-full bg-paper p-1">
              <Avatar user={profile} size={96} />
            </span>
            <div className="pb-1">
              <h1 className="font-display text-3xl">{profile.displayName}</h1>
              <p className="text-ink-faint">@{profile.username}</p>
            </div>
          </div>

          {isSelf && (
            <div className="flex gap-2 pb-1">
              <ButtonLink to="/settings" variant="secondary" size="sm">
                Edit profile
              </ButtonLink>
              {isArtist && (
                <ButtonLink to="/posts/new" size="sm">
                  Add work
                </ButtonLink>
              )}
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_18rem]">
          <div className="min-w-0 space-y-10">
            {profile.artist?.headline && (
              <p className="font-display text-xl text-ink-soft">
                {profile.artist.headline}
              </p>
            )}

            {profile.bio && (
              <section>
                <h2 className="eyebrow mb-2">About</h2>
                <p className="whitespace-pre-wrap leading-relaxed text-ink-soft">
                  {profile.bio}
                </p>
              </section>
            )}

            {isArtist && (
              <section>
                <div className="mb-4 flex items-baseline justify-between gap-4">
                  <h2 className="font-display text-2xl">Portfolio</h2>
                  <ThreadRule className="w-16" />
                </div>
                <Portfolio username={profile.username} />
              </section>
            )}

            <section>
              <div className="mb-4 flex items-baseline justify-between gap-4">
                <h2 className="font-display text-2xl">Reviews</h2>
                <ThreadRule className="w-16" />
              </div>
              <Reviews username={profile.username} />
            </section>
          </div>

          <aside className="space-y-6">
            <Card className="p-5">
              <div className="space-y-5 pl-3">
                <RatingSummary profile={profile} />

                {location && (
                  <div>
                    <h2 className="eyebrow mb-1">Based in</h2>
                    <p className="text-sm text-ink-soft">{location}</p>
                  </div>
                )}

                {profile.artist && (
                  <>
                    <div>
                      <h2 className="eyebrow mb-1">Available</h2>
                      <p className="text-sm text-ink-soft">
                        {profile.artist.acceptingCommissions
                          ? "Taking on new commissions"
                          : "Not taking commissions right now"}
                      </p>
                    </div>

                    {profile.artist.categories.length > 0 && (
                      <div>
                        <h2 className="eyebrow mb-2">Crafts</h2>
                        <ul className="flex flex-wrap gap-1.5">
                          {profile.artist.categories.map((category) => (
                            <li key={category.slug}>
                              <Tag>{category.name}</Tag>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {profile.artist.skills.length > 0 && (
                      <div>
                        <h2 className="eyebrow mb-2">Specialties</h2>
                        <ul className="flex flex-wrap gap-1.5">
                          {profile.artist.skills.map((skill) => (
                            <li key={skill}>
                              <Tag>{skill}</Tag>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}

                <LinkList links={profile.links} />

                <p className="border-t border-fiber pt-4 text-xs text-ink-faint">
                  Joined{" "}
                  {new Date(profile.createdAt).toLocaleDateString("en-PH", {
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
            </Card>

            {isArtist && !isSelf && user?.role === "client" && (
              <Card className="p-5">
                <div className="pl-3">
                  <p className="text-sm text-ink-soft">
                    Post a request in their craft and they can bid on it.
                  </p>
                  <div className="mt-3">
                    <ButtonLink to="/postings/new" size="sm">
                      Post a request
                    </ButtonLink>
                  </div>
                </div>
              </Card>
            )}
          </aside>
        </div>

        {profile.role === "client" && profile.completedCommissions === 0 && (
          <div className="mt-10">
            <EmptyState
              title="No commissions yet"
              description="This client has not completed a commission on RaxTan so far."
            />
          </div>
        )}

        <p className="mt-12 text-sm text-ink-faint">
          <Link to="/discover" className="hover:text-ink hover:underline">
            Back to discover
          </Link>
        </p>
      </Page>
    </>
  );
}
