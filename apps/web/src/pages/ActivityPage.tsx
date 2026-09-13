import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  REACTION_LABELS,
  type ActivityItemDto,
  type ActivityKind,
  type Paginated,
} from "@craftbid/shared";
import { api } from "../lib/api.js";
import { cx } from "../lib/cx.js";
import { Page } from "../components/layout/Shell.js";
import { Button } from "../components/ui/Button.js";
import {
  EmptyState,
  ErrorState,
  PageHeading,
  Pagination,
  RowSkeleton,
} from "../components/ui/States.js";

const LIMIT = 30;

const FILTERS: { value: ActivityKind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "reaction", label: "Reactions" },
  { value: "comment", label: "Comments" },
  { value: "save", label: "Saved" },
  { value: "share", label: "Shared" },
];

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-PH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

function describe(item: ActivityItemDto): string {
  const artist = item.post.artist.displayName;
  switch (item.kind) {
    case "reaction":
      return `You reacted ${item.reaction ? REACTION_LABELS[item.reaction] : ""} to ${artist}'s post`;
    case "comment":
      return `You commented on ${artist}'s post`;
    case "save":
      return `You saved ${artist}'s post`;
    case "share":
      return `You shared ${artist}'s post to your profile`;
  }
}

/** Undoing an entry from the history, through the same endpoints the post uses. */
function undoRequest(item: ActivityItemDto): { label: string; run: () => Promise<unknown> } {
  switch (item.kind) {
    case "reaction":
      return { label: "Remove reaction", run: () => api.delete(`/posts/${item.post.id}/reaction`) };
    case "comment":
      return { label: "Delete comment", run: () => api.delete(`/comments/${item.comment!.id}`) };
    case "save":
      return { label: "Unsave", run: () => api.delete(`/posts/${item.post.id}/save`) };
    case "share":
      return { label: "Remove share", run: () => api.delete(`/posts/${item.post.id}/share`) };
  }
}

function ActivityRow({ item }: { item: ActivityItemDto }) {
  const queryClient = useQueryClient();
  const undo = undoRequest(item);
  const mutation = useMutation({
    mutationFn: undo.run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  return (
    <li className="flex items-start gap-3 py-3">
      <Link to={`/posts/${item.post.id}`} className="shrink-0">
        {item.post.coverImage ? (
          <img
            src={item.post.coverImage.url}
            alt=""
            loading="lazy"
            className="size-14 rounded-sm border border-fiber object-cover"
          />
        ) : (
          <span className="block size-14 rounded-sm border border-fiber bg-paper-sunk" />
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          <Link to={`/posts/${item.post.id}`} className="hover:underline">
            {describe(item)}
          </Link>
        </p>
        <p className="truncate text-sm text-ink-soft">{item.post.caption}</p>
        {item.comment && (
          <p className="mt-1 rounded-sm bg-paper-sunk px-2 py-1 text-sm text-ink-soft">
            “{item.comment.body}”
          </p>
        )}
        {item.caption && (
          <p className="mt-1 rounded-sm bg-paper-sunk px-2 py-1 text-sm text-ink-soft">
            “{item.caption}”
          </p>
        )}
        <p className="mt-1 text-xs text-ink-faint">
          <time dateTime={item.at}>{timeLabel(item.at)}</time>
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="shrink-0"
      >
        {undo.label}
      </Button>
    </li>
  );
}

/**
 * Activity history: what this person liked, commented on, saved and shared,
 * and when, grouped by day like Facebook's activity log. Private to them.
 */
export function ActivityPage() {
  const [kind, setKind] = useState<ActivityKind | "all">("all");
  const [offset, setOffset] = useState(0);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["activity", kind, offset],
    queryFn: () =>
      api.get<Paginated<ActivityItemDto>>(
        `/me/activity?limit=${LIMIT}&offset=${offset}${kind === "all" ? "" : `&kind=${kind}`}`,
      ),
  });

  const groups: { day: string; items: ActivityItemDto[] }[] = [];
  for (const item of data?.items ?? []) {
    const day = dayLabel(item.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }

  return (
    <Page width="narrow">
      <PageHeading
        eyebrow="Your account"
        title="Activity history"
        description="Posts you reacted to, commented on, saved and shared, and when. Only you can see this."
      />

      <div className="mb-6 flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={kind === filter.value}
            onClick={() => {
              setKind(filter.value);
              setOffset(0);
            }}
            className={cx(
              "press rounded-sm border px-3 py-1.5 text-sm transition-colors",
              kind === filter.value
                ? "border-indigo bg-indigo text-paper-raised"
                : "border-fiber bg-paper-raised text-ink-soft hover:text-ink",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <RowSkeleton count={5} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="When you react to, comment on, save or share a post, it is listed here with the date and time."
          action={{ label: "Browse recent work", to: "/" }}
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.day}>
              <h2 className="eyebrow mb-1">{group.day}</h2>
              <ul className="divide-y divide-fiber border-y border-fiber">
                {group.items.map((item) => (
                  <ActivityRow
                    key={`${item.kind}-${item.post.id}-${item.comment?.id ?? ""}`}
                    item={item}
                  />
                ))}
              </ul>
            </section>
          ))}
          {data && (
            <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
          )}
        </div>
      )}
    </Page>
  );
}
