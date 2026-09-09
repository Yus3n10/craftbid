import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ImageDto, UserSummaryDto } from "@craftbid/shared";
import { formatPesoCompact } from "@craftbid/shared";
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
        // `lift` carries the hover movement and the paired image scale; the
        // focus ring still has to appear for keyboard users, who get no hover.
        interactive && "lift focus-within:shadow-lift",
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
  fit = "contain",
}: {
  image: ImageDto | null;
  alt: string;
  className?: string;
  aspect?: string;
  /**
   * `contain` is the default, and on a marketplace for handmade work it is the
   * only defensible one: a crocheted cardigan photographed upright lost its
   * hood and its hem to a 4:3 crop, which is the part of the piece the client
   * is trying to show. The frame stays a fixed size so the grid still lines
   * up, and the piece sits on the sunk paper ground like a mounted print.
   *
   * `cover` remains for square thumbnails, where filling the tile matters more
   * than seeing the whole frame and the crop is small.
   */
  fit?: "cover" | "contain";
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
      // Real pixel dimensions, so the browser reserves the right box before
      // the bytes arrive instead of reflowing the grid underneath the reader.
      width={image.width}
      height={image.height}
      // lift-media: scales a touch when its card is hovered, so the photograph
      // is the thing that responds rather than the frame around it.
      className={cx(
        "lift-media w-full bg-paper-sunk",
        fit === "cover" ? "object-cover" : "object-contain",
        className,
      )}
      style={{ aspectRatio: aspect }}
    />
  );
}
