import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { daysAgo, type ArtistPostDto, type FeedItemDto, type ShareDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { Avatar, Card } from "./ui/Primitives.js";
import { CommentIcon } from "./ui/Icons.js";
import { Dialog } from "./ui/Dialog.js";
import { ErrorState, RowSkeleton } from "./ui/States.js";
import { ClampedText } from "./ClampedText.js";
import { CommentThread } from "./CommentThread.js";
import { FeedPost } from "./FeedPost.js";
import { ReactionBar, ReactionSummaryLine } from "./ReactionBar.js";
import { ShareMenu } from "./ShareMenu.js";

/**
 * The original post, loaded fresh, in its own card: its own reactions and
 * comments, exactly as on the artist's profile.
 */
function OriginalPostDialog({ post, open, onClose }: { post: FeedItemDto; open: boolean; onClose: () => void }) {
  const { data, error, refetch } = useQuery({
    queryKey: ["post", post.id],
    queryFn: () => api.get<ArtistPostDto>(`/posts/${post.id}`),
    enabled: open,
  });

  return (
    <Dialog open={open} onClose={onClose} title={`${post.artist.displayName}'s post`} size="lg">
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data ? (
        <FeedPost post={data} />
      ) : (
        <RowSkeleton count={3} />
      )}
    </Dialog>
  );
}

/**
 * A post someone shared to their profile.
 *
 * It is the sharer's card, with its own reactions and comments. The post it
 * shares sits inside as a preview, credited to the artist who made it, and
 * opens the real post with that post's own reactions and comments. Before this,
 * the card simply was the original, so reacting to a share reacted to the post.
 */
export function SharedPostCard({ post, share }: { post: FeedItemDto; share: ShareDto }) {
  const [showComments, setShowComments] = useState(false);
  const [openOriginal, setOpenOriginal] = useState(false);
  const cover = post.images[0];

  return (
    <Card categorySlug={post.category?.slug} className="overflow-hidden">
      <article aria-label={`${share.user.displayName} shared ${post.artist.displayName}'s post`}>
        <header className="flex items-start gap-3 p-4 pl-5">
          <Link to={`/artists/${share.user.username}`} className="shrink-0">
            <Avatar user={share.user} size={40} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-soft">
              <Link to={`/artists/${share.user.username}`} className="font-medium text-ink hover:underline">
                {share.user.displayName}
              </Link>{" "}
              shared a post
            </p>
            <p className="text-xs text-ink-faint">{daysAgo(share.createdAt)}</p>
          </div>
        </header>

        {share.caption && (
          <div className="px-4 pb-3 pl-5">
            <ClampedText className="whitespace-pre-wrap break-words text-ink">{share.caption}</ClampedText>
          </div>
        )}

        <div className="px-4 pl-5">
          <button
            type="button"
            onClick={() => setOpenOriginal(true)}
            aria-label={`Open ${post.artist.displayName}'s original post: ${post.caption}`}
            className="block w-full overflow-hidden rounded-md border border-fiber bg-paper text-left transition-colors hover:border-fiber-strong"
          >
            <span className="flex items-center gap-2 px-3 pt-3">
              <Avatar user={post.artist} size={28} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{post.artist.displayName}</span>
                <span className="block text-xs text-ink-faint">
                  {daysAgo(post.createdAt)}
                  {post.category ? ` · ${post.category.name}` : ""}
                </span>
              </span>
            </span>
            <span className="block px-3 py-2 text-sm text-ink line-clamp-3 whitespace-pre-wrap break-words">
              {post.caption}
            </span>
            {cover && (
              <span className="block bg-paper-sunk">
                <img
                  src={cover.url}
                  alt=""
                  width={cover.width}
                  height={cover.height}
                  loading="lazy"
                  className="mx-auto max-h-80 w-auto max-w-full object-contain"
                />
              </span>
            )}
          </button>
        </div>

        <div className="space-y-3 p-4 pl-5">
          {(share.reactions.total > 0 || share.commentCount > 0) && (
            <div className="flex items-center justify-between gap-3">
              <ReactionSummaryLine reactions={share.reactions} />
              {share.commentCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowComments((open) => !open)}
                  className="text-xs text-ink-soft hover:text-ink hover:underline"
                >
                  {share.commentCount} {share.commentCount === 1 ? "comment" : "comments"}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-fiber pt-3">
            <ReactionBar postId={share.id} on="share" reactions={share.reactions} />
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
              {/* Sharing from here shares the original, which is what there is to share. */}
              <ShareMenu post={post} />
            </div>
          </div>

          {showComments && <CommentThread postId={share.id} on="share" artistId={share.user.id} />}
        </div>
      </article>

      <OriginalPostDialog post={post} open={openOriginal} onClose={() => setOpenOriginal(false)} />
    </Card>
  );
}
