import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx.js";

/**
 * Text that folds to a few lines, with "See more" when it is longer.
 *
 * Measured, not counted: the limit is so many lines of whatever font, size and
 * width the reader has, so a caption that fits on a laptop can still fold on a
 * phone. The height is the container's own line-height times `lines`, and a
 * ResizeObserver re-checks when the width changes, so rotating a phone or
 * resizing a window gets it right. Whitespace and emoji render as they are.
 *
 * The button stops its click from reaching anything the text sits inside, so
 * expanding a caption never opens the post or the image behind it.
 */
export function ClampedText({
  children,
  lines = 5,
  className,
}: {
  children: ReactNode;
  lines?: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState<number | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
      const max = Math.round(lineHeight * lines);
      setLimit(max);
      // scrollHeight is the full text whether or not it is folded.
      setOverflowing(element.scrollHeight > max + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children, lines]);

  const folded = overflowing && !expanded;

  return (
    <div>
      <div
        ref={box}
        className={cx("overflow-hidden", className)}
        style={folded && limit ? { maxHeight: limit } : undefined}
      >
        {children}
      </div>
      {overflowing && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          className="mt-1 text-sm font-medium text-indigo hover:underline"
        >
          {expanded ? "See less" : "See more"}
        </button>
      )}
    </div>
  );
}
