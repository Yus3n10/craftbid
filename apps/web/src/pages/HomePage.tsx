import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CRAFT_CATEGORIES, type ArtistPostDto, type Paginated, type PostingDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { materialColor } from "../lib/materials.js";
import { ButtonLink } from "../components/ui/Button.js";
import { ThreadRule } from "../components/ui/Primitives.js";
import { CardSkeleton, EmptyState, ErrorState } from "../components/ui/States.js";
import { PostingCard } from "../components/PostingCard.js";
import { PostCard } from "../components/PostCard.js";

/**
 * The hero states the exchange itself rather than decorating around it: one
 * person wants something made, another can make it. The two panels are the two
 * discovery paths the product actually has, and the woven seam between them is
 * the thing being described.
 */
function Hero() {
  const { user } = useAuth();

  return (
    <section className="border-b border-fiber bg-paper-raised">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
        <p className="eyebrow">Handmade in the Philippines</p>
        <h1 className="mt-4 max-w-3xl font-display text-4xl leading-[1.08] sm:text-6xl">
          Someone wants a thing made by hand.
          <span className="block text-indigo">Someone can make it.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-ink-soft">
          Craftbid is where Filipino crafters and the people who commission them
          find each other. Post what you want made, or bid on work that suits
          your hands.
        </p>

        <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-fiber bg-fiber sm:grid-cols-2">
          <div className="bg-paper p-7">
            <h2 className="font-display text-2xl">I want something made</h2>
            <p className="mt-2 text-sm text-ink-soft">
              Describe the piece, set your starting budget in pesos, and compare
              the artists who bid.
            </p>
            <div className="mt-6">
              <ButtonLink
                to={user?.role === "client" ? "/postings/new" : "/register"}
              >
                Post a craft request
              </ButtonLink>
            </div>
          </div>

          <div className="bg-paper p-7">
            <h2 className="font-display text-2xl">I make things</h2>
            <p className="mt-2 text-sm text-ink-soft">
              Build a portfolio, bid on requests in your craft, and get reviewed
              on work you have finished.
            </p>
            <div className="mt-6">
              <ButtonLink
                to={user?.role === "artist" ? "/postings" : "/register"}
                variant="secondary"
              >
                Find commissions
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CategoryStrip() {
  return (
    <section className="border-b border-fiber">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="eyebrow mb-4">Crafts on Craftbid</h2>
        <ul className="flex flex-wrap gap-2">
          {CRAFT_CATEGORIES.map((category) => (
            <li key={category.slug}>
              <Link
                to={`/postings?category=${category.slug}`}
                className="inline-flex items-center gap-2 rounded-sm border border-fiber bg-paper-raised py-1.5 pl-2 pr-3 text-sm text-ink-soft transition-colors hover:border-fiber-strong hover:text-ink"
              >
                <span
                  aria-hidden="true"
                  className="h-4 w-1 rounded-full"
                  style={{ background: materialColor(category.slug) }}
                />
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function LatestRequests() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["postings", "home"],
    queryFn: () =>
      api.get<Paginated<PostingDto>>("/postings?status=open&limit=3&sort=newest"),
  });

  return (
    <section className="mx-auto max-w-6xl px-4 py-14">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl sm:text-3xl">Open craft requests</h2>
          <ThreadRule className="mt-3 w-20" />
        </div>
        <Link
          to="/postings"
          className="shrink-0 text-sm font-medium text-indigo hover:underline"
        >
          See all requests
        </Link>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <CardSkeleton count={3} />
          ) : data && data.items.length > 0 ? (
            data.items.map((posting) => (
              <PostingCard key={posting.id} posting={posting} />
            ))
          ) : (
            <div className="sm:col-span-2 lg:col-span-3">
              <EmptyState
                title="No open requests yet"
                description="Nobody has posted a craft request so far. If you want something made, yours would be the first."
                action={{ label: "Post a craft request", to: "/postings/new" }}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RecentWork() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["posts", "home"],
    queryFn: () => api.get<Paginated<ArtistPostDto>>("/posts?limit=4"),
  });

  return (
    <section className="border-t border-fiber bg-paper-raised">
      <div className="mx-auto max-w-6xl px-4 py-14">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl">Recent work</h2>
            <ThreadRule className="mt-3 w-20" />
          </div>
          <Link
            to="/discover"
            className="shrink-0 text-sm font-medium text-indigo hover:underline"
          >
            Discover artists
          </Link>
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {isLoading ? (
              <CardSkeleton count={4} />
            ) : data && data.items.length > 0 ? (
              data.items.map((post) => <PostCard key={post.id} post={post} />)
            ) : (
              <div className="sm:col-span-2 lg:col-span-4">
                <EmptyState
                  title="No work posted yet"
                  description="Artists have not shared any pieces yet. If you make things, your portfolio would be the first here."
                  action={{ label: "Join as an artist", to: "/register" }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <>
      <Hero />
      <CategoryStrip />
      <LatestRequests />
      <RecentWork />
    </>
  );
}
