import { z } from "zod";
import { PAGINATION } from "../constants.js";

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
  .refine((value) => /^https:\/\//i.test(value), "Link must start with https://");

/** Trims, then treats an empty string as absent. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional();
