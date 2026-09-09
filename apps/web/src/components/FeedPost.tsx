import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ArtistPostDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { cx } from "../lib/cx.js";
import { Avatar, Card } from "./ui/Primitives.js";
import { BookmarkIcon, CommentIcon, ShareIcon } from "./ui/Icons.js";
import { ReactionBar, ReactionSummaryLine } from "./ReactionBar.js";
import { CommentThread } from "./CommentThread.js";
import { Lightbox } from "./Lightbox.js";

function postedAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * One piece of work in the feed.
 *
 * The photograph is the point, so it gets the width and is never cropped, and
 * everything else is arranged around it: who made it above, what people made
 * of it below.
 */
export function FeedPost({ post }: { post: ArtistPostDto }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showComments, setShowComments] = useState(false);
  const [zoomed, setZoomed] = useState<number | null>(null);
  const [shared, setShared] = useState(false);
  const [saved, setSaved] = useState(post.saved ?? false);

  const save = useMutation({
    mutationFn: (next: boolean) =>
      next
        ? api.put(`/posts/${post.id}/save`)
        : api.delete(`/posts/${post.id}/save`),
    onError: () => setSaved(post.saved ?? false),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  function toggleSave() {
    if (!user) {
      navigate("/login", { state: { from: window.location.pathname } });
      return;
    }
    const next = !saved;
    setSaved(next);
    save.mutate(next);
  }

  /**
   * Share copies a link rather than opening a share sheet everywhere.
   *
   * navigator.share exists on phones and almost nowhere on desktop, so the
   * clipboard is the path that always works and the share sheet is the
   * upgrade where it is offered.
   */
  async function share() {
    const url = `${window.location.origin}/posts/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: post.caption, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // A cancelled share sheet and a blocked clipboard both land here, and
      // neither is worth interrupting anyone over.
    }
  }

  const cover = post.images[0];

  return (
    <Card categorySlug={post.category?.slug} className="overflow-hidden">
      <article>
        <header className="flex items-start gap-3 p-4 pl-5">
          <Link to={`/artists/${post.artist.username}`}>
            <Avatar user={post.artist} size={40} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              to={`/artists/${post.artist.username}`}
              className="font-medium hover:underline"
            >
              {post.artist.displayName}
            </Link>
            <p className="text-xs text-ink-faint">
              {postedAgo(post.createdAt)}
              {post.category ? ` · ${post.category.name}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleSave}
            aria-pressed={saved}
            aria-label={saved ? "Remove from saved" : "Save this post"}
            className={cx(
              "press rounded-md p-2 transition-colors",
              saved ? "text-indigo" : "text-ink-faint hover:bg-paper-sunk hover:text-ink",
            )}
          >
            <BookmarkIcon filled={saved} />
          </button>
        </header>

        <div className="px-4 pb-3 pl-5">
          <p className="whitespace-pre-wrap">{post.caption}</p>
          {post.description && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">
              {post.description}
            </p>
          )}
        </div>

        {cover && (
          <button
            type="button"
            onClick={() => setZoomed(0)}
            aria-label={`View "${post.caption}" full size`}
            className="block w-full cursor-zoom-in bg-paper-sunk"
          >
            <img
              src={cover.url}
              alt={post.caption}
              width={cover.width}
              height={cover.height}
              loading="lazy"
              // Height-capped rather than cropped: an upright piece stays
              // upright, and a very tall one still leaves the reactions on
              // screen.
              className="mx-auto max-h-[36rem] w-auto max-w-full object-contain"
            />
          </button>
        )}

        {post.images.length > 1 && (
          <ul className="flex gap-2 overflow-x-auto px-4 pt-3 pl-5">
            {post.images.map((image, index) => (
              <li key={image.id}>
                <button
                  type="button"
                  onClick={() => setZoomed(index)}
                  aria-label={`View image ${index + 1} of ${post.images.length}`}
                  className="block overflow-hidden rounded-sm border border-fiber hover:border-indigo"
                >
                  <img
                    src={image.url}
                    alt=""
                    loading="lazy"
                    className="size-14 object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3 p-4 pl-5">
          {(post.reactions.total > 0 || post.commentCount > 0) && (
            <div className="flex items-center justify-between gap-3">
              <ReactionSummaryLine reactions={post.reactions} />
              {post.commentCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowComments((open) => !open)}
                  className="text-xs text-ink-soft hover:text-ink hover:underline"
                >
                  {post.commentCount}{" "}
                  {post.commentCount === 1 ? "comment" : "comments"}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-fiber pt-3">
            <ReactionBar postId={post.id} reactions={post.reactions} />

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowComments((open) => !open)}
                aria-expanded={showComments}
                className="press inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink"
              >
                <CommentIcon />
                <span>Comment</span>
              </button>

              <button
                type="button"
                onClick={() => void share()}
                className="press inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink"
              >
                <ShareIcon />
                <span>{shared ? "Link copied" : "Share"}</span>
              </button>
            </div>
          </div>

          {showComments && (
            <CommentThread postId={post.id} artistId={post.artist.id} />
          )}
        </div>
      </article>

      <Lightbox
        images={post.images}
        index={zoomed}
        onClose={() => setZoomed(null)}
        onIndexChange={setZoomed}
        alt={post.caption}
      />
    </Card>
  );
}
