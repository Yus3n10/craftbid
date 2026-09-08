import { z } from "zod";
import { LIMITS, REPORT_TARGET_TYPES } from "../constants.js";
import { optionalText, uuidSchema } from "./common.js";

/**
 * Reviews are write-once. There is no update or delete schema, and the API
 * exposes no such route: a reputation system whose history can be rewritten
 * is not a reputation system.
 */
export const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: optionalText(LIMITS.reviewBody.max),
});

export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: uuidSchema,
  reason: z.enum([
    "spam",
    "inappropriate",
    "scam",
    "harassment",
    "stolen_work",
    "other",
  ]),
  details: optionalText(1000),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type CreateReportInput = z.infer<typeof createReportSchema>;
