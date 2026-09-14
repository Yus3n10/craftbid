import { z } from "zod";
import { LIMITS, LINK_PLATFORMS, PH_REGIONS, CRAFT_CATEGORY_SLUGS } from "../constants.js";
import { NO_EMOJI_MESSAGE, containsEmoji, httpsUrlSchema, optionalText, uuidSchema } from "./common.js";

/** A place name: any script, no emoji. */
const citySchema = optionalText(80).refine(
  (value) => value === undefined || !containsEmoji(value),
  NO_EMOJI_MESSAGE,
);

/** Region and city only. Street addresses are never collected. */
export const locationSchema = z.object({
  region: z.enum(PH_REGIONS).optional(),
  city: citySchema,
});

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(LIMITS.displayName.min)
    .max(LIMITS.displayName.max)
    .optional(),
  bio: optionalText(LIMITS.bio.max),
  region: z.enum(PH_REGIONS).nullish(),
  city: citySchema,
  avatarImageId: uuidSchema.nullish(),
  coverImageId: uuidSchema.nullish(),
});

export const updateArtistProfileSchema = z.object({
  headline: optionalText(LIMITS.headline.max),
  acceptingCommissions: z.boolean().optional(),
  categorySlugs: z
    .array(z.enum(CRAFT_CATEGORY_SLUGS as [string, ...string[]]))
    .max(CRAFT_CATEGORY_SLUGS.length)
    .optional(),
  skills: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .min(LIMITS.skillLength.min)
        .max(LIMITS.skillLength.max),
    )
    .max(LIMITS.skillsPerArtist)
    .optional(),
});

/**
 * A contact link.
 *
 * Two schemes and no others. https for anything on the web, mailto for an
 * email address, and a bare address is normalised into a mailto so nobody has
 * to know to type the prefix. Everything else is rejected here and again by a
 * CHECK on the table, because a javascript: or data: URL rendered as a profile
 * link is a stored cross-site scripting hole.
 */
export const contactUrlSchema = z
  .string()
  .trim()
  .min(1, "Add a link or an email address.")
  .max(500)
  .refine((value) => !containsEmoji(value), NO_EMOJI_MESSAGE)
  .transform((value) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${value}` : value,
  )
  .refine(
    (value) => /^https:\/\/\S+\.\S+/i.test(value) || /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value),
    "Use a link starting with https:// or an email address.",
  );

export const externalLinkSchema = z.object({
  platform: z.enum(LINK_PLATFORMS),
  url: contactUrlSchema,
  label: optionalText(60),
});

export const updateExternalLinksSchema = z.object({
  links: z.array(externalLinkSchema).max(LIMITS.linksPerUser),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateArtistProfileInput = z.infer<typeof updateArtistProfileSchema>;
export type ExternalLinkInput = z.infer<typeof externalLinkSchema>;
