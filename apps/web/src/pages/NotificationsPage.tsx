import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationDto, NotificationType } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { cx } from "../lib/cx.js";
import { Page } from "../components/layout/Shell.js";
import { Button } from "../components/ui/Button.js";
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
  payment_submitted: "The client recorded a payment. Check that you received it.",
  payment_confirmed: "A payment was confirmed as received.",
  payment_rejected: "The artist says a payment did not arrive. Check the details.",
  work_finished: "Your piece is finished. See the photos.",
  commission_shipped: "Your piece is on its way.",
  problem_reported: "A problem was reported on a commission.",
  problem_closed: "A reported problem on a commission was closed.",
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
  transfer: "The client will pay the balance after seeing photos of the finished piece. Ship once it arrives.",
  cod: "The client will pay the balance cash on delivery, to the courier.",
  meetup: "The client will pay the balance in cash when you meet.",
};

function describe(notification: NotificationDto): string {
  if (notification.type === "balance_method_chosen") {
    const method = (notification.payload as { method?: string }).method;
    return (method && BALANCE_METHOD_COPY[method]) ?? COPY.balance_method_chosen;
  }
  if (notification.type === "post_reaction") {
    const kind = (notification.payload as { kind?: string }).kind;
    return (kind && REACTION_COPY[kind]) ?? COPY.post_reaction;
  }
  return COPY[notification.type];
}

function linkFor(notification: NotificationDto): string {
  const payload = notification.payload as {
    postingId?: string;
    commissionId?: string;
    postId?: string;
  };
  if (payload.commissionId) return `/commissions/${payload.commissionId}`;
  if (payload.postingId) return `/postings/${payload.postingId}`;
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

  const markRead = useMutation({
    mutationFn: () => api.post("/notifications/read"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <Page width="narrow">
      <PageHeading
        title="Notifications"
        description="Activity on your requests, bids and commissions."
        actions={
          data && data.unread > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              loading={markRead.isPending}
              onClick={() => markRead.mutate()}
            >
              Mark all read
            </Button>
          ) : undefined
        }
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
