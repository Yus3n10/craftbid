import { z } from "zod";
import { PAGINATION } from "../constants.js";

/**
 * Emoji, by Unicode property rather than by listing ranges: pictographs
 * (including skin tones and the older symbols like the heart), the regional
 * indicators that make flags, and the joiner and variation selector that bind
 * sequences together. Plain letters in any script, digits and punctuation are
 * not matched, so "Peña" and "Parañaque" are unaffected.
 */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u200D|\uFE0F|\u20E3/u;

export function containsEmoji(value: string): boolean {
  return EMOJI.test(value);
}

/**
 * For fields that name a real thing with no emoji in it: the name on a bank
 * or wallet account, a bank, a city, a link. Posts, comments, chat, display
 * names and a bid's reason deliberately do not use this.
 */
export const NO_EMOJI_MESSAGE = "Emoji can't be used here.";

/** Public identifiers are UUIDs (v7), never sequential integers. */
export const uuidSchema = z.string().uuid();

export const idParamSchema = z.object({ id: uuidSchema });

export const paginationSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.maxLimit)
    .default(PAGINATION.defaultLimit),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Only https links are accepted. A marketplace that renders user-supplied URLs
 * must never allow javascript:, data:, or plain http.
 */
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((value) => /^https:\/\//i.test(value), "Link must start with https://")
  .refine((value) => !containsEmoji(value), NO_EMOJI_MESSAGE);

/** Trims, then treats an empty string as absent. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional();

/**
 * One search box over three kinds of thing. `q` is short on purpose: a
 * substring scan cannot use an index, so the length cap is what stops a very
 * long term turning into a slow full-table read.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, "Type at least two characters.").max(80),
  kind: z.enum(["all", "artists", "clients", "posts", "requests"]).default("all"),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});
