import { z } from "zod";
import { MODERATION_RULES, PAYMENT_STATUSES, USER_ROLES, USER_STATUSES } from "../constants.js";
import { optionalText, paginationSchema, uuidSchema } from "./common.js";

export const moderationInputSchema = z.object({
  rule: z.enum(MODERATION_RULES),
  note: optionalText(1000),
  /** The report this action settles, if it came from one. */
  reportId: uuidSchema.optional(),
});
export type ModerationInput = z.infer<typeof moderationInputSchema>;

export const unsuspendSchema = z.object({ note: optionalText(1000) });

export const resolveReportSchema = z.object({ note: optionalText(1000) });

export const adminListQuerySchema = paginationSchema.extend({
  status: z.string().max(20).optional(),
});

export const adminUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  email: z.enum(["confirmed", "unconfirmed"]).optional(),
  status: z.enum(USER_STATUSES).optional(),
  role: z.enum(USER_ROLES).optional(),
});
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;

/** Staff settle a reported problem: carry on, or call the commission off. */
export const resolveProblemSchema = z.object({
  outcome: z.enum(["continue", "cancel"]),
  note: z
    .string()
    .trim()
    .min(5, "Write a note both people will read.")
    .max(1000, "Notes can be up to 1000 characters."),
});
export type ResolveProblemInput = z.infer<typeof resolveProblemSchema>;

export const adminProblemsQuerySchema = paginationSchema.extend({
  status: z.enum(["open", "closed"]).optional(),
});

export const adminPaymentsQuerySchema = paginationSchema.extend({
  status: z.enum(PAYMENT_STATUSES).optional(),
  /** A username of either person, or a reference number. */
  q: z.string().trim().max(60).optional(),
});
export type AdminPaymentsQuery = z.infer<typeof adminPaymentsQuerySchema>;

export const roleSwitchSchema = z.object({ role: z.enum(USER_ROLES) });

/** The text parts of a bug report; the screenshot arrives as a file part. */
export const bugReportFieldsSchema = z.object({
  description: z.string().trim().min(10).max(2000),
  pageUrl: z.string().trim().max(500).optional(),
  userAgent: z.string().trim().max(500).optional(),
});
