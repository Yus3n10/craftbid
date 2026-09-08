/**
 * The mark is a warp-and-weft crossing: two threads over, one under. It is the
 * smallest honest picture of weaving, and it reads at 24px.
 */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          x="0.75"
          y="0.75"
          width="22.5"
          height="22.5"
          rx="3.5"
          fill="var(--color-indigo)"
        />
        {/* warp: vertical threads */}
        <path
          d="M8.5 4v16M15.5 4v16"
          stroke="var(--color-paper)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        {/* weft: horizontal threads, interrupted where they pass under */}
        <path
          d="M4 8.5h3.2M9.8 8.5h4.4M16.8 8.5H20"
          stroke="var(--color-clay)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M4 15.5h4.4M11.2 15.5h4.4M18.2 15.5H20"
          stroke="var(--color-paper)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.75"
        />
      </svg>
      <span className="font-display text-xl font-semibold tracking-tight text-ink">
        RaxTan
      </span>
    </span>
  );
}
