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
