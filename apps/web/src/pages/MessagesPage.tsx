import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ConversationSummaryDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { cx } from "../lib/cx.js";
import { Page } from "../components/layout/Shell.js";
import { Avatar, Card } from "../components/ui/Primitives.js";
import { EmptyState, ErrorState, PageHeading, RowSkeleton } from "../components/ui/States.js";
import { messageTime } from "../components/chat/messageTime.js";

/**
 * Every conversation this person has written or received a message in.
 *
 * Refreshed every half minute while the tab is open, which is enough for a
 * list: an open conversation checks far more often.
 */
export function MessagesPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["conversations", "list"],
    queryFn: () => api.get<{ items: ConversationSummaryDto[] }>("/conversations"),
    refetchInterval: 30_000,
  });

  return (
    <Page width="narrow">
      <PageHeading title="Messages" description="Conversations about your requests, bids and commissions." />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">
          <RowSkeleton count={4} />
        </div>
      ) : data?.items.length === 0 ? (
        <EmptyState
          title="No messages yet"
          description="Start a conversation from a bid, from a request you bid on, or from a commission."
          action={{ label: "See craft requests", to: "/postings" }}
        />
      ) : (
        <ul className="space-y-2">
          {data?.items.map((conversation) => (
            <li key={conversation.id}>
              <Link to={`/messages/${conversation.id}`} className="block">
                <Card interactive className={cx("p-4", conversation.unread && "bg-indigo-wash/40")}>
                  <div className="flex items-start gap-3 pl-3">
                    <Avatar user={conversation.otherParty} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className={cx("truncate text-sm text-ink", conversation.unread ? "font-semibold" : "font-medium")}>
                          {conversation.otherParty.displayName}
                        </p>
                        <span className="shrink-0 text-xs text-ink-faint">
                          {messageTime(conversation.lastMessage.createdAt)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-ink-faint">{conversation.posting.title}</p>
                      <p className={cx("mt-1 truncate text-sm", conversation.unread ? "text-ink" : "text-ink-soft")}>
                        {conversation.lastMessage.mine && <span className="text-ink-faint">You: </span>}
                        {conversation.lastMessage.body || (conversation.lastMessage.hasImage ? "Sent a photo" : "")}
                      </p>
                    </div>
                    {conversation.unread && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-indigo" aria-label="Unread" />
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
