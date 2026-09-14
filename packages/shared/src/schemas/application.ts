import { z } from "zod";
import { APPLICATION_STATUSES, LIMITS } from "../constants.js";
import { optionalText, paginationSchema, uuidSchema } from "./common.js";
import { budgetCentavosSchema } from "./posting.js";

export const createApplicationSchema = z.object({
  /**
   * May be below the client's starting budget. Whether it is, and so whether
   * `belowBudgetReason` is required, is decided on the server against the
   * posting read inside the transaction, never from anything sent here.
   */
  proposedPriceCentavos: budgetCentavosSchema,
  /**
   * Required when the price is below the starting budget, ignored otherwise.
   * Blank or whitespace-only counts as missing.
   */
  belowBudgetReason: optionalText(LIMITS.belowBudgetReason.max),
  coverLetter: z
    .string()
    .trim()
    .min(LIMITS.coverLetter.min)
    .max(LIMITS.coverLetter.max),
  /** Artist posts shown to the client as relevant work samples. */
  samplePostIds: z.array(uuidSchema).max(LIMITS.applicationSamples.max).default([]),
});

export const applicationListQuerySchema = paginationSchema.extend({
  status: z.enum(APPLICATION_STATUSES).optional(),
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
