import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatPeso, type SearchResultsDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { Page } from "../components/layout/Shell.js";
import { Avatar, Card, ThreadRule } from "../components/ui/Primitives.js";
import { EmptyState, ErrorState, RowSkeleton } from "../components/ui/States.js";
import { PageHeading } from "../components/ui/States.js";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section>
      <h2 className="font-display text-xl">
        {title} <span className="text-ink-faint tabular">({count})</span>
      </h2>
      <ThreadRule className="mt-2 w-12" />
      <div className="mt-4">{children}</div>
    </section>
  );
}

function PersonRow({
  person,
}: {
  person: SearchResultsDto["artists"][number];
}) {
  return (
    <li>
      <Link
        to={`/artists/${person.username}`}
        className="flex items-center gap-3 rounded-md border border-fiber bg-paper-raised p-3 transition-colors hover:border-fiber-strong"
      >
        <Avatar user={person} size={40} />
        <span className="min-w-0">
          <span className="block truncate font-medium">{person.displayName}</span>
          <span className="block text-xs text-ink-faint">
            @{person.username} · {person.role === "artist" ? "Artist" : "Client"}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["search", "page", q],
    queryFn: () =>
      api.get<SearchResultsDto>(`/search?q=${encodeURIComponent(q)}&limit=20`),
    enabled: q.length >= 2,
  });

  const total =
    (data?.artists.length ?? 0) +
    (data?.clients.length ?? 0) +
    (data?.posts.length ?? 0) +
    (data?.requests.length ?? 0);

  return (
    <Page>
      <PageHeading
        eyebrow="Search"
        title={q ? `Results for “${q}”` : "Search"}
        description="Artists, clients, work and open craft requests."
      />

      {q.length < 2 ? (
        <EmptyState
          title="Type at least two characters"
          description="Search for an artist by name, a craft, or something you want made."
          action={{ label: "Browse craft requests", to: "/postings" }}
        />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <RowSkeleton count={4} />
      ) : total === 0 ? (
        <EmptyState
          title={`Nothing matches “${q}”`}
          description="Try a shorter word, or the name of a craft such as crochet or weaving."
          action={{ label: "Browse all requests", to: "/postings" }}
        />
      ) : (
        <div className="space-y-10">
          <Section title="Artists" count={data?.artists.length ?? 0}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {data?.artists.map((person) => (
                <PersonRow key={person.id} person={person} />
              ))}
            </ul>
          </Section>

          <Section title="Clients" count={data?.clients.length ?? 0}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {data?.clients.map((person) => (
                <PersonRow key={person.id} person={person} />
              ))}
            </ul>
          </Section>

          <Section title="Work" count={data?.posts.length ?? 0}>
            <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {data?.posts.map((post) => (
                <li key={post.id}>
                  <Link to={`/posts/${post.id}`} className="group block">
                    <Card interactive className="overflow-hidden">
                      {post.coverImage ? (
                        <img
                          src={post.coverImage.url}
                          alt=""
                          width={post.coverImage.width}
                          height={post.coverImage.height}
                          loading="lazy"
                          className="lift-media w-full bg-paper-sunk object-contain"
                          style={{ aspectRatio: "4 / 3" }}
                        />
                      ) : (
                        <div
                          className="bg-paper-sunk"
                          style={{ aspectRatio: "4 / 3" }}
                        />
                      )}
                      <p className="p-3 pl-4 text-sm leading-snug">{post.caption}</p>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Open requests" count={data?.requests.length ?? 0}>
            <ul className="space-y-3">
              {data?.requests.map((request) => (
                <li key={request.id}>
                  <Link
                    to={`/postings/${request.id}`}
                    className="flex items-center justify-between gap-4 rounded-md border border-fiber bg-paper-raised p-4 transition-colors hover:border-fiber-strong"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {request.title}
                      </span>
                      <span className="block text-xs text-ink-faint">
                        {request.category.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular text-clay">
                      from {formatPeso(request.minBudgetCentavos)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </Page>
  );
}
