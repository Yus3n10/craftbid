import { Link } from "react-router-dom";
import type { ArtistPostDto } from "@raxtan/shared";
import { Card, ImageFrame, UserChip } from "./ui/Primitives.js";

/**
 * The portfolio unit. Handmade work is judged by looking at it, so the image
 * gets the space and the text stays out of its way.
 */
export function PostCard({ post }: { post: ArtistPostDto }) {
  return (
    <Card categorySlug={post.category?.slug} interactive className="flex flex-col">
      <div className="pl-1">
        <ImageFrame
          image={post.coverImage}
          alt={post.caption}
          aspect="1 / 1"
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4 pl-5">
        {post.category && <span className="eyebrow">{post.category.name}</span>}

        <p className="line-clamp-2 font-display text-base leading-snug text-ink">
          {post.caption}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <UserChip user={post.artist} size={26} />
          <Link
            to={`/artists/${post.artist.username}`}
            className="text-xs text-ink-faint hover:text-ink hover:underline"
          >
            View work
          </Link>
        </div>
      </div>
    </Card>
  );
}
