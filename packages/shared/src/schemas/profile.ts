import { z } from "zod";
import { LIMITS, LINK_PLATFORMS, PH_REGIONS, CRAFT_CATEGORY_SLUGS } from "../constants.js";
import { httpsUrlSchema, optionalText, uuidSchema } from "./common.js";

/** Region and city only. Street addresses are never collected. */
export const locationSchema = z.object({
  region: z.enum(PH_REGIONS).optional(),
  city: optionalText(80),
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
  city: optionalText(80),
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

export const externalLinkSchema = z.object({
  platform: z.enum(LINK_PLATFORMS),
  url: httpsUrlSchema,
  label: optionalText(60),
});

export const updateExternalLinksSchema = z.object({
  links: z.array(externalLinkSchema).max(LIMITS.linksPerUser),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateArtistProfileInput = z.infer<typeof updateArtistProfileSchema>;
export type ExternalLinkInput = z.infer<typeof externalLinkSchema>;
