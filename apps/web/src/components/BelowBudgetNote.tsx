import { formatPesoCompact } from "@craftbid/shared";
import { cx } from "../lib/cx.js";

/**
 * Says a bid is under the client's starting budget, and the artist's reason.
 *
 * Amber, the warning tone, rather than rust: a lower price is something to
 * read, not an error, and the artist should not look suspect for offering it.
 * The reason is the artist's own words, rendered as text.
 */
export function BelowBudgetNote({
  priceCentavos,
  startingBudgetCentavos,
  reason,
  audience,
  className,
}: {
  priceCentavos: number;
  startingBudgetCentavos: number;
  reason?: string;
  /** Whose screen this is on, which decides "your" and "their". */
  audience: "client" | "artist";
  className?: string;
}) {
  if (priceCentavos >= startingBudgetCentavos) return null;
  const under = formatPesoCompact(startingBudgetCentavos - priceCentavos);
  const budget = formatPesoCompact(startingBudgetCentavos);

  return (
    <div className={cx("rounded-md bg-amber-wash px-3 py-2.5 text-sm", className)}>
      <p className="font-medium text-amber">
        {audience === "client"
          ? `${under} below your starting budget of ${budget}`
          : `${under} below the client's starting budget of ${budget}`}
      </p>
      {reason && (
        <p className="mt-1 whitespace-pre-wrap break-words text-ink">
          <span className="text-ink-soft">{audience === "client" ? "Their reason: " : "Your reason: "}</span>
          {reason}
        </p>
      )}
    </div>
  );
}
