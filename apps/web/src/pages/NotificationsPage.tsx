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
};

function linkFor(notification: NotificationDto): string {
  const payload = notification.payload as {
    postingId?: string;
    commissionId?: string;
  };
  if (payload.commissionId) return `/commissions/${payload.commissionId}`;
  if (payload.postingId) return `/postings/${payload.postingId}`;
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
                      <p className="text-sm text-ink">{COPY[notification.type]}</p>
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
