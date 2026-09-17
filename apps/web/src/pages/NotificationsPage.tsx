import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MODERATION_RULE_COPY, type ModerationRule, type NotificationDto, type NotificationType } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { cx } from "../lib/cx.js";
import { Page } from "../components/layout/Shell.js";
import { Card } from "../components/ui/Primitives.js";
import {
  EmptyState,
  ErrorState,
  PageHeading,
  RowSkeleton,
} from "../components/ui/States.js";

const COPY: Record<NotificationType, string> = {
  application_received: "An artist bid on your craft request.",
  application_accepted: "Your bid was accepted. The commission has started.",
  application_rejected: "Your bid was not chosen this time.",
  commission_completed: "A commission was closed.",
  review_received: "Someone left you a review.",
  post_reaction: "Someone reacted to your work.",
  post_comment: "Someone commented on your work.",
  post_shared: "Someone shared your work to their profile.",
  balance_method_chosen: "The client chose how they will pay the balance.",
  account_warning: "A warning from Craftbid.",
  content_removed: "Craftbid removed something you posted.",
  share_reaction: "Someone reacted to a post you shared.",
  share_comment: "Someone commented on a post you shared.",
  payment_submitted: "The client recorded a payment. Check that you received it.",
  payment_confirmed: "A payment was confirmed as received.",
  payment_rejected: "The artist says a payment did not arrive. Check the details.",
  work_finished: "Your piece is finished.",
  commission_shipped: "Your piece is on its way.",
  problem_reported: "A problem was reported on a commission.",
  problem_closed: "A reported problem on a commission was closed.",
  chat_unread: "You have an unread message.",
};

/**
 * Reaction copy says which reaction it was, because "someone reacted" is
 * almost no information and the three kinds mean genuinely different things.
 */
const REACTION_COPY: Record<string, string> = {
  love: "Someone loved a piece of your work.",
  support: "Someone backed your work.",
  like: "Someone liked a piece of your work.",
};

/** Says which option, since it changes what the artist does next. */
const BALANCE_METHOD_COPY: Record<string, string> = {
  transfer: "The client will pay the balance after the piece arrives. Ship it once it is finished.",
  meetup: "The client will pay the balance in cash when you meet.",
};

function describe(notification: NotificationDto): string {
  if (notification.type === "account_warning" || notification.type === "content_removed") {
    const payload = notification.payload as { rule?: ModerationRule; note?: string | null; kind?: string; excerpt?: string };
    const rule = payload.rule ? MODERATION_RULE_COPY[payload.rule] : null;
    const what = { post: "post", posting: "request", comment: "comment" }[payload.kind ?? ""] ?? "post";
    const head =
      notification.type === "account_warning"
        ? `Warning from Craftbid${rule ? `: ${rule.label}.` : "."}`
        : `We removed your ${what}${payload.excerpt ? ` "${payload.excerpt}"` : ""}${rule ? `: ${rule.label}.` : "."}`;
    return [head, rule?.sentence, payload.note].filter(Boolean).join(" ");
  }
  if (notification.type === "balance_method_chosen") {
    const method = (notification.payload as { method?: string }).method;
    return (method && BALANCE_METHOD_COPY[method]) ?? COPY.balance_method_chosen;
  }
  if (notification.type === "post_reaction") {
    const kind = (notification.payload as { kind?: string }).kind;
    return (kind && REACTION_COPY[kind]) ?? COPY.post_reaction;
  }
  if (notification.type === "chat_unread") {
    const { fromName, postingTitle } = notification.payload as { fromName?: string; postingTitle?: string };
    if (fromName && postingTitle) return `${fromName} sent you a message about ${postingTitle}. It is still unread.`;
    return COPY.chat_unread;
  }
  return COPY[notification.type];
}

function linkFor(notification: NotificationDto): string {
  const payload = notification.payload as {
    postingId?: string;
    commissionId?: string;
    postId?: string;
    conversationId?: string;
  };
  if (notification.type === "chat_unread") {
    return payload.conversationId ? `/messages/${payload.conversationId}` : "/messages";
  }
  if (payload.commissionId) return `/commissions/${payload.commissionId}`;
  if (payload.postingId) return `/postings/${payload.postingId}`;
  // Engagement on a share leads to the sharer's own profile, where the share is.
  if (notification.type === "share_reaction" || notification.type === "share_comment") {
    const sharer = (notification.payload as { sharerUsername?: string }).sharerUsername;
    return sharer ? `/artists/${sharer}` : "/notifications";
  }
  // A warning or a removal has nothing to open; its text is the message.
  if (notification.type === "account_warning" || notification.type === "content_removed") return "/notifications";
  // A reaction or comment leads to the piece it was about.
  if (payload.postId) return `/posts/${payload.postId}`;
  return "/commissions";
}

export function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () =>
      api.get<{ items: NotificationDto[]; total: number; unread: number }>(
        "/notifications?limit=50",
      ),
  });

  /**
   * Opening the page is reading it.
   *
   * Once the list is on screen, the server is told the newest notification it
   * showed, and marks that and everything older read. The badge clears only
   * when the server has done it, so the two never disagree. The list itself is
   * not refetched, so what was new on this visit stays highlighted until the
   * reader leaves; the next visit shows it read.
   */
  const markRead = useMutation({
    mutationFn: (throughId: string) => api.post("/notifications/read", { throughId }),
    onSuccess: () => {
      queryClient.setQueryData(["notifications", "unread"], { unread: 0 });
      void queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
    },
  });
  const reported = useRef<string | null>(null);
  const newest = data?.items[0];
  const hasUnread = Boolean(data && data.unread > 0);
  useEffect(() => {
    if (!newest || !hasUnread || reported.current === newest.id) return;
    reported.current = newest.id;
    markRead.mutate(newest.id);
  }, [newest, hasUnread, markRead]);

  // Leaving drops the highlighted copy, so coming back shows them read.
  useEffect(
    () => () => void queryClient.invalidateQueries({ queryKey: ["notifications", "list"] }),
    [queryClient],
  );

  return (
    <Page width="narrow">
      <PageHeading
        title="Notifications"
        description="Activity on your requests, bids and commissions."
      />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">
          <RowSkeleton count={4} />
        </div>
      ) : data?.items.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="When someone bids on your request, accepts your bid, or leaves you a review, it shows up here."
          action={{ label: "Browse craft requests", to: "/postings" }}
        />
      ) : (
        <ul className="space-y-2">
          {data?.items.map((notification) => (
            <li key={notification.id}>
              <Link to={linkFor(notification)} className="block">
                <Card
                  interactive
                  className={cx("p-4", !notification.readAt && "bg-indigo-wash/40")}
                >
                  <div className="flex items-start justify-between gap-4 pl-3">
                    <div>
                      <p className="text-sm text-ink">{describe(notification)}</p>
                      <p className="mt-1 text-xs text-ink-faint">
                        {new Date(notification.createdAt).toLocaleString("en-PH", {
                          day: "numeric",
                          month: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    {!notification.readAt && (
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-clay"
                        aria-label="Unread"
                      />
                    )}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
