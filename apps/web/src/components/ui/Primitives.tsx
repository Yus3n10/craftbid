import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ImageDto, UserSummaryDto } from "@raxtan/shared";
import { formatPesoCompact } from "@raxtan/shared";
import { cx } from "../../lib/cx.js";
import { selvedgeStyle } from "../../lib/materials.js";

/** A surface with the woven selvedge on its leading edge. */
export function Card({
  categorySlug,
  className,
  children,
  interactive,
}: {
  categorySlug?: string;
  className?: string;
  children: ReactNode;
  interactive?: boolean;
}) {
  return (
    <div
      style={selvedgeStyle(categorySlug)}
      className={cx(
        "selvedge relative overflow-hidden rounded-md border border-fiber bg-paper-raised",
        interactive &&
          "transition-shadow duration-200 hover:shadow-lift focus-within:shadow-lift",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ThreadRule({ className }: { className?: string }) {
  return <div className={cx("thread-rule", className)} aria-hidden="true" />;
}

/** A peso figure. Clay is reserved for money, so amounts read at a glance. */
export function Money({
  centavos,
  className,
  size = "md",
}: {
  centavos: number;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-3xl",
  };
  return (
    <span
      className={cx(
        "tabular font-display font-semibold text-clay",
        sizes[size],
        className,
      )}
    >
      {formatPesoCompact(centavos)}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-sage-wash text-sage",
  in_progress: "bg-indigo-wash text-indigo",
  completed: "bg-paper-sunk text-ink-soft",
  cancelled: "bg-rust-wash text-rust",
  pending: "bg-amber-wash text-amber",
  accepted: "bg-sage-wash text-sage",
  rejected: "bg-paper-sunk text-ink-soft",
  withdrawn: "bg-paper-sunk text-ink-soft",
  active: "bg-indigo-wash text-indigo",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open for bids",
  in_progress: "Artist selected",
  completed: "Completed",
  cancelled: "Cancelled",
  pending: "Awaiting reply",
  accepted: "Accepted",
  rejected: "Not selected",
  withdrawn: "Withdrawn",
  active: "In progress",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold",
        STATUS_STYLES[status] ?? "bg-paper-sunk text-ink-soft",
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-fiber bg-paper px-2 py-0.5 text-xs text-ink-soft">
      {children}
    </span>
  );
}

export function Avatar({
  user,
  size = 40,
}: {
  user: Pick<UserSummaryDto, "displayName" | "avatar">;
  size?: number;
}) {
  const initials = user.displayName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  if (user.avatar) {
    return (
      <img
        src={user.avatar.url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="shrink-0 rounded-full border border-fiber object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-fiber bg-indigo-wash font-display font-semibold text-indigo"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || "?"}
    </span>
  );
}

export function UserChip({
  user,
  size = 32,
  subtitle,
}: {
  user: UserSummaryDto;
  size?: number;
  subtitle?: string;
}) {
  return (
    <Link
      to={`/artists/${user.username}`}
      className="group inline-flex items-center gap-2.5"
    >
      <Avatar user={user} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink group-hover:underline">
          {user.displayName}
        </span>
        {subtitle && (
          <span className="block truncate text-xs text-ink-faint">{subtitle}</span>
        )}
      </span>
    </Link>
  );
}

export function ImageFrame({
  image,
  alt,
  className,
  aspect = "4 / 3",
}: {
  image: ImageDto | null;
  alt: string;
  className?: string;
  aspect?: string;
}) {
  if (!image) {
    return (
      <div
        className={cx(
          "flex items-center justify-center bg-paper-sunk text-ink-faint",
          className,
        )}
        style={{ aspectRatio: aspect }}
      >
        <span className="text-xs">No image yet</span>
      </div>
    );
  }

  return (
    <img
      src={image.url}
      alt={alt}
      loading="lazy"
      className={cx("w-full bg-paper-sunk object-cover", className)}
      style={{ aspectRatio: aspect }}
    />
  );
}
