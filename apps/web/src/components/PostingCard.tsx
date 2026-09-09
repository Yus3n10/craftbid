import { Link } from "react-router-dom";
import type { PostingDto } from "@craftbid/shared";
import { Card, ImageFrame, Money, StatusBadge } from "./ui/Primitives.js";

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

export function PostingCard({ posting }: { posting: PostingDto }) {
  const bids = posting.applicationCount;

  return (
    <Card categorySlug={posting.category.slug} interactive className="flex flex-col">
      <div className="pl-1">
        <ImageFrame
          image={posting.images[0] ?? null}
          alt={`Reference image for ${posting.title}`}
          aspect="4 / 3"
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <span className="eyebrow">{posting.category.name}</span>
          <StatusBadge status={posting.status} />
        </div>

        <h3 className="font-display text-lg leading-snug">
          <Link
            to={`/postings/${posting.id}`}
            className="after:absolute after:inset-0 hover:underline"
          >
            {posting.title}
          </Link>
        </h3>

        <p className="line-clamp-2 text-sm text-ink-soft">{posting.description}</p>

        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
          <div>
            <span className="eyebrow block">Starting at</span>
            <Money centavos={posting.minBudgetCentavos} />
          </div>
          <div className="text-right text-xs text-ink-faint">
            <span className="block">
              {bids === 0 ? "No bids yet" : bids === 1 ? "1 bid" : `${bids} bids`}
            </span>
            <span className="block">{timeAgo(posting.createdAt)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
