import { cx } from "../../lib/cx.js";

/**
 * Star ratings, drawn rather than typed.
 *
 * These were the characters ★ and ☆ until now, which looked fine on one
 * machine and wrong on others: they are glyphs from whatever font happens to
 * resolve them, so their weight, size and vertical alignment drift between
 * platforms, and they cannot take a stroke or a partial fill. A screen reader
 * also reads "black star black star black star" unless the label is right.
 *
 * One path, filled or outlined, sized from the surrounding text.
 */

const STAR_PATH =
  "M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9L12 2.6z";

function Star({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cx("h-[1em] w-[1em] shrink-0", className)}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
      strokeLinejoin="round"
    >
      <path d={STAR_PATH} />
    </svg>
  );
}

export function Stars({
  value,
  className,
}: {
  /** 0 to 5. Rounded to the nearest whole star for display. */
  value: number;
  className?: string;
}) {
  const filled = Math.round(Math.max(0, Math.min(5, value)));

  return (
    <span
      className={cx("inline-flex items-center gap-0.5 text-amber", className)}
      role="img"
      aria-label={`${value.toFixed(1)} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} filled={n <= filled} />
      ))}
    </span>
  );
}

/**
 * The picker used when leaving a review.
 *
 * Each star is its own button so it is reachable by keyboard and announces
 * what it does, rather than being one control that needs a mouse to aim at.
 */
export function StarPicker({
  value,
  onChange,
  name = "rating",
}: {
  value: number;
  onChange: (value: number) => void;
  name?: string;
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          name={name}
          onClick={() => onChange(n)}
          className={cx(
            "rounded-sm p-1 text-2xl transition-[color,transform] duration-150 ease-out",
            "hover:scale-110 active:scale-95",
            n <= value ? "text-amber" : "text-fiber-strong hover:text-amber",
          )}
        >
          <Star filled={n <= value} />
        </button>
      ))}
    </div>
  );
}
