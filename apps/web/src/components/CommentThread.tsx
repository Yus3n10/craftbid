import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LIMITS, type CommentDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { Avatar } from "./ui/Primitives.js";
import { Button } from "./ui/Button.js";
import { FormError, RowSkeleton } from "./ui/States.js";
import { TrashIcon } from "./ui/Icons.js";

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
  });
}

function Comment({
  comment,
  postId,
  canModerate,
}: {
  comment: CommentDto;
  postId: string;
  canModerate: boolean;
}) {
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.delete(`/comments/${comment.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["comments", postId] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  return (
    <li className="flex gap-2.5">
      <Link to={`/artists/${comment.author.username}`} className="shrink-0">
        <Avatar user={comment.author} size={32} />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="rounded-lg rounded-tl-sm bg-paper-sunk px-3 py-2">
          <Link
            to={`/artists/${comment.author.username}`}
            className="text-sm font-medium hover:underline"
          >
            {comment.author.displayName}
          </Link>
          <p className="whitespace-pre-wrap break-words text-sm text-ink-soft">
            {comment.body}
          </p>
        </div>

        <div className="mt-1 flex items-center gap-3 pl-1 text-xs text-ink-faint">
          <span>{timeAgo(comment.createdAt)}</span>
          {(comment.mine || canModerate) && (
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="inline-flex items-center gap-1 hover:text-rust"
            >
              <TrashIcon className="size-3.5" />
              {comment.mine ? "Delete" : "Remove"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * A post's comments, and the box to add one.
 *
 * Loaded only when the thread is opened rather than with the feed. Twenty
 * cards each pulling their comments would be twenty requests for text almost
 * nobody scrolls to, on connections where that is the expensive part.
 */
export function CommentThread({
  postId,
  artistId,
}: {
  postId: string;
  /** The post's owner, who may remove comments from their own page. */
  artistId: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["comments", postId],
    queryFn: () => api.get<CommentDto[]>(`/posts/${postId}/comments`),
  });

  const add = useMutation({
    mutationFn: () => api.post<CommentDto>(`/posts/${postId}/comments`, { body }),
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({ queryKey: ["comments", postId] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  const comments = data ?? [];

  return (
    <div className="space-y-4 border-t border-fiber pt-4">
      {isLoading ? (
        <RowSkeleton count={2} />
      ) : error ? (
        <p className="text-sm text-ink-faint">Comments could not be loaded.</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-ink-faint">
          No comments yet. Say something useful about the work.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              postId={postId}
              canModerate={user?.id === artistId}
            />
          ))}
        </ul>
      )}

      {user ? (
        <form
          className="flex items-start gap-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim()) add.mutate();
          }}
        >
          <Avatar user={user} size={32} />
          <div className="min-w-0 flex-1 space-y-2">
            <label htmlFor={`comment-${postId}`} className="sr-only">
              Write a comment
            </label>
            <textarea
              id={`comment-${postId}`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={LIMITS.commentBody.max}
              rows={2}
              placeholder="Write a comment"
              className="w-full resize-y rounded-md border border-fiber-strong bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-indigo focus:outline-none focus:ring-2 focus:ring-indigo/20"
            />
            <FormError error={add.error} />
            <Button
              type="submit"
              size="sm"
              loading={add.isPending}
              disabled={body.trim().length === 0}
            >
              Comment
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-ink-faint">
          <Link to="/login" className="font-medium text-indigo hover:underline">
            Sign in
          </Link>{" "}
          to join the conversation.
        </p>
      )}
    </div>
  );
}
