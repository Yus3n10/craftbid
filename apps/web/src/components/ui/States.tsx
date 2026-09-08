import type { ReactNode } from "react";
import { ApiError } from "../../lib/api.js";
import { cx } from "../../lib/cx.js";
import { Button, ButtonLink } from "./Button.js";
import { ThreadRule } from "./Primitives.js";

/**
 * Skeletons match the real card's proportions so the page does not jump when
 * content lands.
 */
export function CardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="animate-pulse overflow-hidden rounded-md border border-fiber bg-paper-raised"
        >
          <div className="aspect-[4/3] bg-paper-sunk" />
          <div className="space-y-2.5 p-4">
            <div className="h-4 w-3/4 rounded-sm bg-paper-sunk" />
            <div className="h-3 w-1/2 rounded-sm bg-paper-sunk" />
            <div className="h-5 w-1/3 rounded-sm bg-paper-sunk" />
          </div>
        </div>
      ))}
    </>
  );
}

export function RowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-md border border-fiber bg-paper-raised p-4"
        >
          <div className="mb-3 h-4 w-1/3 rounded-sm bg-paper-sunk" />
          <div className="h-3 w-2/3 rounded-sm bg-paper-sunk" />
        </div>
      ))}
    </>
  );
}

/**
 * An empty screen is an invitation to act, so every one of these takes an
 * action rather than only reporting that there is nothing here.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: { label: string; to: string };
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-md border border-dashed border-fiber-strong/60 bg-paper-raised px-6 py-14 text-center",
        className,
      )}
    >
      <h3 className="font-display text-xl text-ink">{title}</h3>
      <ThreadRule className="mx-auto my-4 w-16" />
      <p className="mx-auto max-w-md text-ink-soft">{description}</p>
      {action && (
        <div className="mt-6">
          <ButtonLink to={action.to} variant="secondary">
            {action.label}
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

/**
 * Errors say what happened and what to do about it. They do not apologise and
 * they are never vague, because "something went wrong" leaves the reader with
 * no next move.
 */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const isApiError = error instanceof ApiError;
  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  let title = "This did not load";
  let message =
    "The page could not be loaded. Try again, and if it keeps happening the service may be down.";

  if (offline) {
    title = "You are offline";
    message = "Reconnect to the internet and try again.";
  } else if (isApiError && error.status === 404) {
    title = "Not found";
    message = "This page does not exist, or it was removed by its owner.";
  } else if (isApiError && error.status === 403) {
    title = "You do not have access";
    message = "This belongs to someone else. Sign in with the right account to view it.";
  } else if (isApiError && error.status === 429) {
    title = "Too many requests";
    message = "Wait a minute and try again.";
  } else if (isApiError && error.status >= 500) {
    title = "The service is having trouble";
    message = "This is on our end. Try again in a moment.";
  } else if (isApiError) {
    message = error.message;
  }

  return (
    <div
      role="alert"
      className={cx(
        "rounded-md border border-rust/30 bg-rust-wash px-6 py-10 text-center",
        className,
      )}
    >
      <h3 className="font-display text-xl text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-ink-soft">{message}</p>
      {onRetry && (
        <div className="mt-5">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

/** A short inline message for a failed form submission. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? error.message
      : "Something went wrong. Please try again.";

  return (
    <p
      role="alert"
      className="rounded-md border border-rust/30 bg-rust-wash px-3 py-2 text-sm font-medium text-rust"
    >
      {message}
    </p>
  );
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;

  return (
    <nav
      className="flex items-center justify-between gap-4 pt-2"
      aria-label="Pagination"
    >
      <Button
        variant="secondary"
        size="sm"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Previous
      </Button>
      <span className="text-sm text-ink-faint">
        Page {page} of {pages}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= pages}
        onClick={() => onChange(offset + limit)}
      >
        Next
      </Button>
    </nav>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="font-display text-3xl text-ink sm:text-4xl">{title}</h1>
          {description && (
            <p className="mt-2 max-w-2xl text-ink-soft">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      <ThreadRule className="mt-5 w-24" />
    </header>
  );
}
