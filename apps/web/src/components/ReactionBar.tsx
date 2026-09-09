import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactionKind, ReactionSummary } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { cx } from "../lib/cx.js";
import { FlowerIcon, HandshakeIcon, ThumbUpIcon } from "./ui/Icons.js";

const REACTIONS: {
  kind: ReactionKind;
  label: string;
  Icon: typeof FlowerIcon;
  className: string;
}[] = [
  { kind: "love", label: "Love", Icon: FlowerIcon, className: "text-rust" },
  { kind: "support", label: "Support", Icon: HandshakeIcon, className: "text-sage" },
  { kind: "like", label: "Like", Icon: ThumbUpIcon, className: "text-indigo" },
];

/**
 * The three reactions, and the counts they add up to.
 *
 * Reacting is optimistic: the count moves on the click and rolls back if the
 * request fails. A reaction is a small, cheap, reversible thing, and making
 * someone wait on a sleeping free-tier server before their own click registers
 * is the kind of latency that makes an interface feel broken.
 */
export function ReactionBar({
  postId,
  reactions,
}: {
  postId: string;
  reactions: ReactionSummary;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [local, setLocal] = useState<ReactionSummary | null>(null);

  const current = local ?? reactions;

  const mutation = useMutation({
    mutationFn: (kind: ReactionKind | null) =>
      kind === null
        ? api.delete(`/posts/${postId}/reaction`)
        : api.put(`/posts/${postId}/reaction`, { kind }),
    onError: () => setLocal(null),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
      void queryClient.invalidateQueries({ queryKey: ["post", postId] });
    },
  });

  function choose(kind: ReactionKind) {
    if (!user) {
      navigate("/login", { state: { from: window.location.pathname } });
      return;
    }

    // Clicking the reaction you already have removes it.
    const next = current.mine === kind ? null : kind;

    const optimistic: ReactionSummary = { ...current };
    if (current.mine) optimistic[current.mine] -= 1;
    if (next) optimistic[next] += 1;
    optimistic.mine = next;
    optimistic.total = optimistic.love + optimistic.support + optimistic.like;

    setLocal(optimistic);
    mutation.mutate(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {REACTIONS.map(({ kind, label, Icon, className }) => {
        const chosen = current.mine === kind;
        const count = current[kind];
        return (
          <button
            key={kind}
            type="button"
            onClick={() => choose(kind)}
            aria-pressed={chosen}
            aria-label={`${label}${count > 0 ? `, ${count}` : ""}`}
            className={cx(
              "press inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              chosen
                ? cx("bg-paper-sunk font-medium", className)
                : "text-ink-soft hover:bg-paper-sunk hover:text-ink",
            )}
          >
            <Icon filled={chosen} />
            <span>{label}</span>
            {count > 0 && <span className="tabular text-xs">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The summary line above the buttons: which reactions a post has, and how
 * many people in total. Hidden entirely at zero rather than showing "0",
 * which reads as a judgement on a new post.
 */
export function ReactionSummaryLine({ reactions }: { reactions: ReactionSummary }) {
  if (reactions.total === 0) return null;

  const present = REACTIONS.filter(({ kind }) => reactions[kind] > 0);

  return (
    <div className="flex items-center gap-2 text-xs text-ink-soft">
      <span className="flex -space-x-1">
        {present.map(({ kind, Icon, className }) => (
          <span
            key={kind}
            className={cx(
              "flex size-5 items-center justify-center rounded-full border border-fiber bg-paper-raised",
              className,
            )}
          >
            <Icon filled className="size-3" />
          </span>
        ))}
      </span>
      <span className="tabular">
        {reactions.total} {reactions.total === 1 ? "person" : "people"}
      </span>
    </div>
  );
}
