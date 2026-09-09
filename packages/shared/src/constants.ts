/**
 * Domain constants shared by the API and the web client.
 *
 * The craft categories here are the source of truth for the seed migration.
 * An integration test asserts the database matches this list exactly, so the
 * two cannot silently drift apart.
 */

export const USER_ROLES = ["client", "artist"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["active", "suspended", "deleted"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * A posting starts `open`, becomes `in_progress` when the client selects an
 * artist, then terminates as `completed` or `cancelled`. Applications are
 * accepted only while `open`.
 */
export const POSTING_STATUSES = [
  "open",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type PostingStatus = (typeof POSTING_STATUSES)[number];

export const APPLICATION_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const COMMISSION_STATUSES = ["active", "completed", "cancelled"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const ARTIST_POST_STATUSES = ["published", "hidden", "removed"] as const;
export type ArtistPostStatus = (typeof ARTIST_POST_STATUSES)[number];

export const REPORT_TARGET_TYPES = [
  "posting",
  "user",
  "artist_post",
  "application",
] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_STATUSES = ["open", "reviewed", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "application_received",
  "application_accepted",
  "application_rejected",
  "commission_completed",
  "review_received",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Platforms an artist may link for off-platform contact. */
/**
 * Reactions.
 *
 * Three, deliberately, and each says something a marketplace for handmade work
 * actually needs to distinguish: the piece is beautiful, the maker is worth
 * backing, or a plain nod. A longer list would collect noise, and a single
 * "like" would flatten praise for the work into praise for the person.
 */
export const REACTION_KINDS = ["love", "support", "like"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const REACTION_LABELS: Record<ReactionKind, string> = {
  love: "Love",
  support: "Support",
  like: "Like",
};

export const LINK_PLATFORMS = [
  "facebook",
  "instagram",
  "tiktok",
  "x",
  "youtube",
  "pinterest",
  "shopee",
  "lazada",
  "website",
  "other",
] as const;
export type LinkPlatform = (typeof LINK_PLATFORMS)[number];

export interface CraftCategory {
  slug: string;
  name: string;
  description: string;
}

export const CRAFT_CATEGORIES: readonly CraftCategory[] = [
  { slug: "crochet", name: "Crochet", description: "Hooked yarn work: amigurumi, bouquets, wearables, and home pieces." },
  { slug: "knitting", name: "Knitting", description: "Needle-knit garments, blankets, and accessories." },
  { slug: "embroidery", name: "Embroidery", description: "Hand-stitched thread work on fabric, hoops, and apparel." },
  { slug: "stitch-art", name: "Stitch Art", description: "Cross-stitch, needlepoint, and stitched portraiture." },
  { slug: "weaving", name: "Weaving", description: "Handloom and backstrap weaving, inabel, banig, and rattan." },
  { slug: "pottery", name: "Pottery & Ceramics", description: "Thrown and hand-built clay, glazed and fired." },
  { slug: "painting", name: "Handmade Painting", description: "Original painted works on canvas, paper, wood, or walls." },
  { slug: "sculpture", name: "Sculpture", description: "Carved, cast, and modelled three-dimensional work." },
  { slug: "jewelry", name: "Jewelry", description: "Handmade beadwork, metalwork, resin, and wire pieces." },
  { slug: "woodcraft", name: "Woodcraft", description: "Carving, joinery, turning, and finished wooden goods." },
  { slug: "paper-craft", name: "Paper Craft", description: "Bookbinding, calligraphy, quilling, and paper florals." },
  { slug: "candles-soap", name: "Candles & Soap", description: "Hand-poured candles, soaps, and small-batch home goods." },
  { slug: "other", name: "Other Handmade", description: "Handmade and artisan work outside the categories above." },
] as const;

export const CRAFT_CATEGORY_SLUGS = CRAFT_CATEGORIES.map((c) => c.slug);

/**
 * Philippine administrative regions. Location is deliberately coarse — the
 * platform collects region and city only, never a street address.
 */
export const PH_REGIONS = [
  "National Capital Region (NCR)",
  "Cordillera Administrative Region (CAR)",
  "Region I — Ilocos Region",
  "Region II — Cagayan Valley",
  "Region III — Central Luzon",
  "Region IV-A — CALABARZON",
  "MIMAROPA Region",
  "Region V — Bicol Region",
  "Region VI — Western Visayas",
  "Region VII — Central Visayas",
  "Region VIII — Eastern Visayas",
  "Region IX — Zamboanga Peninsula",
  "Region X — Northern Mindanao",
  "Region XI — Davao Region",
  "Region XII — SOCCSKSARGEN",
  "Region XIII — Caraga",
  "Bangsamoro (BARMM)",
] as const;
export type PhRegion = (typeof PH_REGIONS)[number];

/** Field length and count limits, enforced on both sides of the wire. */
export const LIMITS = {
  displayName: { min: 2, max: 80 },
  username: { min: 3, max: 30 },
  password: { min: 10, max: 200 },
  bio: { max: 1000 },
  commentBody: { max: 1000 },
  headline: { max: 120 },
  postingTitle: { min: 8, max: 140 },
  postingDescription: { min: 30, max: 5000 },
  postingRequirements: { max: 2000 },
  coverLetter: { min: 30, max: 3000 },
  reviewBody: { max: 2000 },
  captionMax: 1000,
  skillsPerArtist: 20,
  skillLength: { min: 2, max: 40 },
  linksPerUser: 8,
  postingImages: { min: 0, max: 8 },
  artistPostImages: { min: 1, max: 10 },
  applicationSamples: { max: 6 },
} as const;

/** Upload rules. Enforced server-side against real file bytes, not headers. */
export const UPLOAD = {
  maxBytes: 5 * 1024 * 1024,
  maxDimension: 4000,
  minDimension: 100,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
  allowedExtensions: [".jpg", ".jpeg", ".png", ".webp"] as const,
} as const;

/** Money bounds, in centavos. */
export const MONEY = {
  /** ₱50.00 — below this a commission is not worth the workflow. */
  minBudgetCentavos: 5_000,
  /** ₱1,000,000.00 */
  maxBudgetCentavos: 100_000_000,
} as const;

export const PAGINATION = {
  defaultLimit: 20,
  maxLimit: 50,
} as const;

/** Single source of the product name, so a rename is a one-file change. */
export const BRAND = {
  name: "Craftbid",
  tagline: "Commission handmade work from Filipino artists.",
} as const;
