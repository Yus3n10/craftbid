import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CHAT_SUGGESTIONS, LIMITS, type ConversationDto, type MessageDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { cx } from "../lib/cx.js";
import { useUnsavedChanges } from "../lib/unsavedChanges.js";
import { Page } from "../components/layout/Shell.js";
import { Button } from "../components/ui/Button.js";
import { TextArea } from "../components/ui/Field.js";
import { Avatar, RoleBadge } from "../components/ui/Primitives.js";
import { ErrorState, FormError, RowSkeleton } from "../components/ui/States.js";
import { messageTime } from "../components/chat/messageTime.js";

/** How often an open conversation asks for new messages, while it is visible. */
const POLL_MS = 5_000;

function mergeById(current: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((message) => message.id));
  const added = incoming.filter((message) => !seen.has(message.id));
  return added.length === 0 ? current : [...current, ...added];
}

/** Whether the reader is at, or nearly at, the newest message. */
function nearBottom(): boolean {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
}

function Header({ conversation }: { conversation: ConversationDto }) {
  return (
    <header className="mb-6 border-b border-fiber pb-5">
      <Link to="/messages" className="text-sm text-indigo hover:underline">
        All messages
      </Link>
      <div className="mt-3 flex items-center gap-3">
        <Link to={`/artists/${conversation.otherParty.username}`} className="shrink-0">
          <Avatar user={conversation.otherParty} size={44} />
        </Link>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-display text-xl">{conversation.otherParty.displayName}</h1>
            <RoleBadge role={conversation.otherParty.role} />
          </div>
          <p className="truncate text-sm text-ink-soft">
            {conversation.stage === "commission" && conversation.commissionId ? (
              <>
                Commission:{" "}
                <Link to={`/commissions/${conversation.commissionId}`} className="text-indigo hover:underline">
                  {conversation.posting.title}
                </Link>
              </>
            ) : (
              <>
                {conversation.myRole === "client" ? "Their bid on " : "Your bid on "}
                <Link
                  to={
                    conversation.myRole === "client"
                      ? `/postings/${conversation.posting.id}/applications`
                      : `/postings/${conversation.posting.id}`
                  }
                  className="text-indigo hover:underline"
                >
                  {conversation.posting.title}
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </header>
  );
}

/**
 * One conversation.
 *
 * New messages arrive by polling: every few seconds while the tab is visible,
 * asking only for what came after the newest message on screen. No sockets,
 * which the free hosting would drop whenever the server sleeps anyway.
 */
export function ConversationPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const latest = useRef<MessageDto[]>([]);
  latest.current = messages;
  const stickToBottom = useRef(true);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useUnsavedChanges(draft.trim() !== "");

  const conversation = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api.get<ConversationDto>(`/conversations/${id}`),
    refetchInterval: 60_000,
  });
  const history = useQuery({
    queryKey: ["conversation", id, "history"],
    queryFn: () => api.get<{ items: MessageDto[] }>(`/conversations/${id}/messages`),
    staleTime: Infinity,
  });

  const markRead = useCallback(() => {
    void api.post(`/conversations/${id}/read`).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    });
  }, [id, queryClient]);

  useEffect(() => {
    if (!history.data) return;
    setMessages(history.data.items);
    markRead();
  }, [history.data, markRead]);

  // Poll for newer messages while the conversation is on screen.
  useEffect(() => {
    if (!history.data) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      if (stopped || document.visibilityState !== "visible") return;
      const last = latest.current.at(-1);
      const query = last ? `?after=${encodeURIComponent(last.createdAt)}` : "";
      api
        .get<{ items: MessageDto[] }>(`/conversations/${id}/messages${query}`)
        .then(({ items }) => {
          if (stopped) return;
          const theirs = items.some((message) => !message.mine && !latest.current.some((m) => m.id === message.id));
          stickToBottom.current = nearBottom();
          setMessages((current) => mergeById(current, items));
          if (theirs) markRead();
        })
        .catch(() => {
          // A missed poll is retried on the next tick; the page stays usable.
        });
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [history.data, id, markRead]);

  // The box grows with what is typed, up to its max-h, then scrolls inside.
  useLayoutEffect(() => {
    const box = input.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [draft]);

  // Follow new messages only if the reader was already at the bottom.
  useLayoutEffect(() => {
    if (stickToBottom.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = useMutation({
    mutationFn: (body: string) => api.post<MessageDto>(`/conversations/${id}/messages`, { body }),
    onSuccess: (message) => {
      stickToBottom.current = true;
      setMessages((current) => mergeById(current, [message]));
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["conversations", "list"] });
    },
  });

  function submit() {
    const body = draft.trim();
    if (!body || send.isPending) return;
    send.mutate(body);
  }

  if (conversation.error || history.error) {
    return (
      <Page width="narrow">
        <ErrorState
          error={conversation.error ?? history.error}
          onRetry={() => {
            void conversation.refetch();
            void history.refetch();
          }}
        />
      </Page>
    );
  }

  if (!conversation.data || !history.data) {
    return (
      <Page width="narrow">
        <RowSkeleton count={4} />
      </Page>
    );
  }

  const data = conversation.data;
  const suggestions = CHAT_SUGGESTIONS[data.myRole][data.stage];

  return (
    <Page width="narrow">
      <Header conversation={data} />

      {messages.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-faint">
          No messages yet. Say hello, or pick a suggestion below.
        </p>
      ) : (
        <ol className="space-y-3" aria-label="Messages">
          {messages.map((message) => (
            <li key={message.id} className={cx("flex", message.mine ? "justify-end" : "justify-start")}>
              <div className={cx("max-w-[85%] sm:max-w-[75%]", message.mine && "text-right")}>
                <p
                  className={cx(
                    "inline-block whitespace-pre-wrap break-words rounded-lg px-3.5 py-2 text-left text-sm",
                    message.mine ? "rounded-br-sm bg-indigo text-paper-raised" : "rounded-bl-sm bg-paper-sunk text-ink",
                  )}
                >
                  {message.body}
                </p>
                <span className="mt-1 block px-1 text-[11px] text-ink-faint">
                  {message.mine ? "You · " : ""}
                  {messageTime(message.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div ref={bottom} />

      {data.canSend ? (
        <form
          className="sticky bottom-0 -mx-4 mt-6 border-t border-fiber bg-paper/95 px-4 pb-4 pt-3 backdrop-blur"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {/* Suggestions fill the box and never send. Three at most, wrapping rather than scrolling sideways. */}
          <ul className="mb-2 flex flex-wrap gap-2" aria-label="Suggested messages">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(suggestion);
                    input.current?.focus();
                  }}
                  className="rounded-2xl border border-fiber bg-paper-raised px-3 py-1.5 text-left text-xs text-ink-soft transition-colors hover:border-fiber-strong hover:text-ink"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>

          <FormError error={send.error} />
          <div className="flex items-end gap-2">
            <label htmlFor="message-body" className="sr-only">
              Message {data.otherParty.displayName}
            </label>
            <TextArea
              ref={input}
              id="message-body"
              value={draft}
              maxLength={LIMITS.messageBody.max}
              rows={1}
              placeholder={`Message ${data.otherParty.displayName}`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends on a keyboard with a mouse; on a phone it makes a new line.
                if (event.key === "Enter" && !event.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                  event.preventDefault();
                  submit();
                }
              }}
              className="min-h-11 max-h-40 flex-1 resize-none"
            />
            <Button type="submit" loading={send.isPending} disabled={draft.trim() === ""}>
              Send
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-6 rounded-md bg-paper-sunk px-4 py-3 text-sm text-ink-soft" role="status">
          {data.stage === "commission"
            ? "This commission was cancelled, so the conversation is closed. You can still read it."
            : "This bid is no longer open, so the conversation is closed. You can still read it."}
        </p>
      )}
    </Page>
  );
}
