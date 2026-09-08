/**
 * Craft categories grouped by what they are made from.
 *
 * The selvedge on every card is tinted by material family, so a grid reads as
 * categories before any label is parsed. Grouping into six families rather
 * than giving each of the thirteen categories its own hue keeps a mixed grid
 * legible instead of confetti.
 */
export type MaterialFamily =
  | "fiber"
  | "earth"
  | "pigment"
  | "metal"
  | "wood"
  | "other";

const FAMILY_BY_CATEGORY: Record<string, MaterialFamily> = {
  crochet: "fiber",
  knitting: "fiber",
  embroidery: "fiber",
  "stitch-art": "fiber",
  weaving: "fiber",
  pottery: "earth",
  sculpture: "earth",
  painting: "pigment",
  jewelry: "metal",
  woodcraft: "wood",
  "paper-craft": "wood",
  "candles-soap": "wood",
  other: "other",
};

const FAMILY_COLOR: Record<MaterialFamily, string> = {
  fiber: "var(--color-mat-fiber)",
  earth: "var(--color-mat-earth)",
  pigment: "var(--color-mat-pigment)",
  metal: "var(--color-mat-metal)",
  wood: "var(--color-mat-wood)",
  other: "var(--color-mat-other)",
};

export function familyFor(categorySlug: string | undefined): MaterialFamily {
  if (!categorySlug) return "other";
  return FAMILY_BY_CATEGORY[categorySlug] ?? "other";
}

/** Inline style that drives the `.selvedge` band on a card. */
export function selvedgeStyle(
  categorySlug: string | undefined,
): React.CSSProperties {
  return {
    ["--selvedge-color" as string]: FAMILY_COLOR[familyFor(categorySlug)],
  };
}

export function materialColor(categorySlug: string | undefined): string {
  return FAMILY_COLOR[familyFor(categorySlug)];
}
