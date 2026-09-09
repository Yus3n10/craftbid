import { z } from "zod";
import { CRAFT_CATEGORY_SLUGS, LIMITS, REACTION_KINDS } from "../constants.js";
import { optionalText, paginationSchema, uuidSchema } from "./common.js";

/**
 * One entity serves both the artist's portfolio and the public feed. On a
 * profile it reads as a portfolio item; in discovery it reads as a post.
 */
export const createArtistPostSchema = z.object({
  caption: z.string().trim().min(1).max(LIMITS.captionMax),
  description: optionalText(2000),
  categorySlug: z
    .enum(CRAFT_CATEGORY_SLUGS as [string, ...string[]])
    .optional(),
  imageIds: z
    .array(uuidSchema)
    .min(LIMITS.artistPostImages.min, "Add at least one image.")
    .max(LIMITS.artistPostImages.max),
});

export const updateArtistPostSchema = createArtistPostSchema.partial();

export const artistPostListQuerySchema = paginationSchema.extend({
  category: z.enum(CRAFT_CATEGORY_SLUGS as [string, ...string[]]).optional(),
  artist: z.string().trim().max(30).optional(),
});

export type CreateArtistPostInput = z.infer<typeof createArtistPostSchema>;

export const setReactionSchema = z.object({
  kind: z.enum(REACTION_KINDS),
});

export const createCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(LIMITS.commentBody.max),
});

/**
 * The feed. Separate from the profile listing because it has its own axes:
 * everything, only what you saved, or only a single craft.
 */
export const feedQuerySchema = paginationSchema.extend({
  category: z.enum(CRAFT_CATEGORY_SLUGS as [string, ...string[]]).optional(),
  saved: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
