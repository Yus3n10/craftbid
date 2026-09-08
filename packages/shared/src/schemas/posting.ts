import { z } from "zod";
import {
  CRAFT_CATEGORY_SLUGS,
  LIMITS,
  MONEY,
  POSTING_STATUSES,
} from "../constants.js";
import { optionalText, paginationSchema, uuidSchema } from "./common.js";

const categorySlugSchema = z.enum(CRAFT_CATEGORY_SLUGS as [string, ...string[]]);

/**
 * Budget arrives as centavos so no float ever crosses the wire. The client
 * sends 150000 for ₱1,500.00.
 */
export const budgetCentavosSchema = z
  .number()
  .int("Budget must be a whole number of centavos.")
  .min(MONEY.minBudgetCentavos)
  .max(MONEY.maxBudgetCentavos);

export const createPostingSchema = z.object({
  title: z
    .string()
    .trim()
    .min(LIMITS.postingTitle.min)
    .max(LIMITS.postingTitle.max),
  description: z
    .string()
    .trim()
    .min(LIMITS.postingDescription.min)
    .max(LIMITS.postingDescription.max),
  categorySlug: categorySlugSchema,
  minBudgetCentavos: budgetCentavosSchema,
  requirements: optionalText(LIMITS.postingRequirements.max),
  deadline: z.coerce.date().optional(),
  imageIds: z.array(uuidSchema).max(LIMITS.postingImages.max).default([]),
});

/**
 * The category and budget are omitted deliberately once applications exist;
 * the route rejects budget changes on a posting that already has bids, because
 * artists priced their work against the advertised minimum.
 */
export const updatePostingSchema = createPostingSchema.partial();

export const postingListQuerySchema = paginationSchema.extend({
  category: categorySlugSchema.optional(),
  status: z.enum(POSTING_STATUSES).optional(),
  minBudget: z.coerce.number().int().min(0).optional(),
  maxBudget: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(["newest", "oldest", "budget_high", "budget_low"]).default("newest"),
});

export type CreatePostingInput = z.infer<typeof createPostingSchema>;
export type UpdatePostingInput = z.infer<typeof updatePostingSchema>;
export type PostingListQuery = z.infer<typeof postingListQuerySchema>;
