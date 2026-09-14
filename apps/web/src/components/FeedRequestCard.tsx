import { useId } from "react";
import { Link } from "react-router-dom";
import { daysAgo, type HomeRequestDto } from "@craftbid/shared";
import { ButtonLink } from "./ui/Button.js";
import { Avatar, Card, ImageFrame, Money } from "./ui/Primitives.js";

/**
 * An open craft request in the home feed.
 *
 * Deliberately without reactions, comments, saves, shares or a bid count. A
 * request is the start of a private negotiation between the client and each
 * artist separately; social actions on it would let artists read each other's
 * interest, which is exactly what private bidding exists to prevent. The card
 * only says what is wanted, for how much, by whom, and where to go to bid.
 */
export function FeedRequestCard({ request }: { request: HomeRequestDto }) {
  const titleId = useId();
  const image = request.images[0] ?? null;

  return (
    <Card categorySlug={request.category.slug}>
      <article aria-labelledby={titleId}>
        <header className="flex items-start gap-3 p-4 pl-5">
          <Link to={`/artists/${request.client.username}`} tabIndex={-1} aria-hidden="true">
            <Avatar user={request.client} size={40} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link to={`/artists/${request.client.username}`} className="font-medium hover:underline">
              {request.client.displayName}
            </Link>
            <p className="text-xs text-ink-faint">
              {daysAgo(request.createdAt)}
              {request.client.city ? ` · ${request.client.city}` : ""}
            </p>
          </div>
          <span className="eyebrow shrink-0 pt-1">Craft request</span>
        </header>

        {image && (
          <div className="pl-1">
            <ImageFrame image={image} alt={`Reference image for ${request.title}`} aspect="4 / 3" />
          </div>
        )}

        <div className="space-y-2 p-4 pl-5">
          <p className="eyebrow">{request.category.name}</p>
          <h3 id={titleId} className="break-words font-display text-xl leading-snug">
            {request.title}
          </h3>
          <p className="line-clamp-2 break-words text-sm text-ink-soft">{request.description}</p>

          <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
            <div>
              <span className="eyebrow block">Starting at</span>
              <Money centavos={request.minBudgetCentavos} />
            </div>
            <ButtonLink to={`/postings/${request.id}`} size="sm" variant="secondary">
              View request
            </ButtonLink>
          </div>
        </div>
      </article>
    </Card>
  );
}
