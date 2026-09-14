import { CRAFT_CATEGORIES } from "./constants.js";

/**
 * How much each kind of action says about someone's interest in a craft.
 *
 * Keeping something (a save, a share) says the most; saying something (a
 * comment) or committing to it (a bid, a request of your own) says a lot; a
 * reaction or a search says a little; opening a craft's list says the least.
 */
export const INTEREST_WEIGHTS = {
  save: 3,
  share: 3,
  comment: 2,
  bid: 2,
  request: 2,
  reaction: 1,
  search: 1,
  browse: 0.5,
} as const;

export type InterestSignal = keyof typeof INTEREST_WEIGHTS;

/** Words too general to say which craft a search is about. */
const IGNORED = new Set(["handmade", "other", "and", "art", "work"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 4 && !IGNORED.has(word));
}

/**
 * Everyday words for a craft that its name does not contain. Kept short: a
 * search that names no craft should add no interest rather than a guess.
 */
const CRAFT_WORDS: Record<string, string> = {
  clay: "pottery",
  bead: "jewelry",
  beads: "jewelry",
  necklace: "jewelry",
  bracelet: "jewelry",
  earrings: "jewelry",
  ring: "jewelry",
  amigurumi: "crochet",
  yarn: "crochet",
  inabel: "weaving",
  banig: "weaving",
  rattan: "weaving",
  woven: "weaving",
  canvas: "painting",
  portrait: "painting",
  carving: "woodcraft",
  calligraphy: "paper-craft",
};

/** Two words share a stem when they agree on their first four letters or more. */
function sameStem(a: string, b: string): boolean {
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
  return shared >= 4;
}

/**
 * The crafts a search names: "ceramic mug" names Pottery & Ceramics, "wooden
 * spoon" names Woodcraft, "bead necklace" names Jewelry, and "birthday gift"
 * names none, so it adds no interest anywhere.
 */
export function categoriesForSearch(term: string): string[] {
  const searched = term.toLowerCase().split(/[^a-z]+/);
  const named = new Set(searched.flatMap((word) => (CRAFT_WORDS[word] ? [CRAFT_WORDS[word]] : [])));
  const stems = searched.filter((word) => word.length >= 4 && !IGNORED.has(word));
  return CRAFT_CATEGORIES.filter((category) => {
    if (named.has(category.slug)) return true;
    const names = words(`${category.slug} ${category.name}`);
    return stems.some((word) => names.some((name) => sameStem(word, name)));
  }).map((category) => category.slug);
}
