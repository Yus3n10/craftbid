import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { daysAgo, type FeedItemDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { useRequireAccount } from "../lib/authPrompt.js";
import { cx } from "../lib/cx.js";
import { Avatar, Card } from "./ui/Primitives.js";
import { BookmarkIcon, CommentIcon } from "./ui/Icons.js";
import { ShareMenu } from "./ShareMenu.js";
import { ReactionBar, ReactionSummaryLine } from "./ReactionBar.js";
import { CommentThread } from "./CommentThread.js";
import { Lightbox } from "./Lightbox.js";
import { PostMoreMenu } from "./PostMenus.js";
import { ClampedText } from "./ClampedText.js";
import { SharedPostCard } from "./SharedPostCard.js";

/**
 * One piece of work in the feed.
 *
 * The photograph is the point, so it gets the width and is never cropped, and
 * everything else is arranged around it: who made it above, what people made
 * of it below.
 */
export function FeedPost({ post }: { post: FeedItemDto }) {
  // A share is its own card with its own engagement; see SharedPostCard.
  if (post.share) return <SharedPostCard post={post} share={post.share} />;
  return <OwnPost post={post} />;
}

function OwnPost({ post }: { post: FeedItemDto }) {
  const { user } = useAuth();
  const requireAccount = useRequireAccount();
  const queryClient = useQueryClient();

  const [showComments, setShowComments] = useState(false);
  const [zoomed, setZoomed] = useState<number | null>(null);
  // A moment of feedback after saving, pointing at where saved posts live.
  const [justSaved, setJustSaved] = useState(false);
  const [saved, setSaved] = useState(post.saved ?? false);

  const save = useMutation({
    mutationFn: (next: boolean) =>
      next
        ? api.put(`/posts/${post.id}/save`)
        : api.delete(`/posts/${post.id}/save`),
    onError: () => setSaved(post.saved ?? false),
    onSuccess: (_data, next) => setJustSaved(next),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
  });

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 5000);
    return () => clearTimeout(timer);
  }, [justSaved]);

  function toggleSave() {
    if (!requireAccount("save posts")) return;
    const next = !saved;
    setSaved(next);
    save.mutate(next);
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
              {daysAgo(post.createdAt)}
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
          <PostMoreMenu post={post} />
        </header>

        {justSaved && (
          <p className="mx-4 mb-3 ml-5 rounded-sm bg-indigo-wash px-3 py-2 text-sm text-ink" role="status">
            Saved.{" "}
            <Link to="/saved" className="font-medium text-indigo underline">
              See your saved posts
            </Link>
          </p>
        )}

        <div className="px-4 pb-3 pl-5">
          {/* Lines longer than about 75 characters are hard to track back. */}
          <ClampedText className="max-w-[75ch] break-words">
            <p className="whitespace-pre-wrap">{post.caption}</p>
            {post.description && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">
                {post.description}
              </p>
            )}
          </ClampedText>
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

              <ShareMenu post={post} />
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
