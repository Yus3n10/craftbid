import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "../../lib/cx.js";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-indigo text-paper-raised hover:bg-indigo-soft active:bg-indigo-deep border border-indigo",
  secondary:
    "bg-paper-raised text-ink border border-fiber-strong hover:bg-paper-sunk",
  ghost: "bg-transparent text-ink-soft hover:bg-paper-sunk hover:text-ink border border-transparent",
  danger: "bg-rust text-paper-raised hover:opacity-90 border border-rust",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

// `press` gives the 3% squash on pointer-down. Tapping a button on a phone
// otherwise has no acknowledgement until the network answers, and on a slow
// connection that gap is long enough for people to tap again.
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium press " +
  "transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none " +
  "whitespace-nowrap";

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading,
  children,
  ...rest
}: CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      className={cx(BASE, VARIANTS[variant], SIZES[size], className)}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading && (
        <span
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

export function ButtonLink({
  to,
  variant = "primary",
  size = "md",
  className,
  children,
}: CommonProps & { to: string }) {
  return (
    <Link
      to={to}
      className={cx(BASE, VARIANTS[variant], SIZES[size], className)}
    >
      {children}
    </Link>
  );
}
