import { z } from "zod";
import { APPLICATION_STATUSES, LIMITS } from "../constants.js";
import { paginationSchema, uuidSchema } from "./common.js";
import { budgetCentavosSchema } from "./posting.js";

export const createApplicationSchema = z.object({
  /**
   * Must be at least the posting's minimum. The server re-reads the live
   * posting inside the transaction rather than trusting anything sent here,
   * and a CHECK constraint enforces it a second time at the database.
   */
  proposedPriceCentavos: budgetCentavosSchema,
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
