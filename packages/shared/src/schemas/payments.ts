import { z } from "zod";
import {
  BALANCE_METHODS,
  LIMITS,
  PAYMENT_KINDS,
  PROBLEM_REASONS,
  TRANSFER_METHODS,
} from "../constants.js";
import { uuidSchema } from "./common.js";

/**
 * A Philippine mobile number, as GCash and Maya accounts are keyed by one.
 * Spaces and dashes are dropped and +63 or 63 becomes 0, so "+63 917-123-4567"
 * and "09171234567" are the same account and compare equal.
 */
export const phMobileSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, "").replace(/^\+?63(?=9)/, "0"))
  .refine((value) => /^09\d{9}$/.test(value), "Enter an 11-digit mobile number starting with 09.");

const bankAccountNumberSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .refine((value) => /^\d{6,20}$/.test(value), "Enter the account number, digits only.");

const accountNameSchema = z
  .string()
  .trim()
  .min(LIMITS.payoutAccountName.min, "Enter the name on the account.")
  .max(LIMITS.payoutAccountName.max);

/**
 * Where an artist is paid. Shown only to the client of an active commission
 * with that artist, and copied onto each payment when it is recorded so a
 * later edit cannot change what a past receipt was paid to.
 */
export const payoutAccountSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("gcash"), accountName: accountNameSchema, accountNumber: phMobileSchema }),
  z.object({ method: z.literal("maya"), accountName: accountNameSchema, accountNumber: phMobileSchema }),
  z.object({
    method: z.literal("bank"),
    accountName: accountNameSchema,
    accountNumber: bankAccountNumberSchema,
    bankName: z.string().trim().min(LIMITS.bankName.min, "Enter the bank.").max(LIMITS.bankName.max),
  }),
]);
export type PayoutAccountInput = z.infer<typeof payoutAccountSchema>;

export const setPayoutAccountsSchema = z.object({
  accounts: z
    .array(payoutAccountSchema)
    .max(TRANSFER_METHODS.length)
    .refine(
      (accounts) => new Set(accounts.map((account) => account.method)).size === accounts.length,
      "Add each payment method once.",
    ),
});

export const balanceMethodSchema = z.object({ method: z.enum(BALANCE_METHODS) });

/**
 * A reference number as it appears on a receipt, compared without spaces,
 * dashes or case so the same transfer typed two ways is still one transfer.
 */
export const referenceNumberSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, "").toUpperCase())
  .refine(
    (value) =>
      value.length >= LIMITS.referenceNumber.min &&
      value.length <= LIMITS.referenceNumber.max &&
      /^[A-Z0-9]+$/.test(value),
    "Enter the reference number from the receipt: letters and digits only.",
  );

/** A calendar date, "YYYY-MM-DD", as the day the money was sent. */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "That date does not exist.");

export const submitPaymentSchema = z.object({
  kind: z.enum(PAYMENT_KINDS),
  method: z.enum(TRANSFER_METHODS),
  /**
   * The client states what they sent. It must equal what is due, which makes
   * a mistyped amount a visible error rather than a silent partial payment.
   */
  amountCentavos: z.number().int().positive(),
  referenceNumber: referenceNumberSchema,
  paidOn: calendarDateSchema,
  receiptFileId: uuidSchema,
});
export type SubmitPaymentInput = z.infer<typeof submitPaymentSchema>;

export const markFinishedSchema = z.object({
  photoFileIds: z
    .array(uuidSchema)
    .min(LIMITS.finishedPhotos.min, "Add at least one photo of the finished piece.")
    .max(LIMITS.finishedPhotos.max)
    .refine((ids) => new Set(ids).size === ids.length, "Each photo can be added once."),
});

export const shippingSchema = z.object({
  courier: z.string().trim().min(LIMITS.courier.min, "Enter the courier.").max(LIMITS.courier.max),
  trackingNumber: z
    .string()
    .trim()
    .max(LIMITS.trackingNumber.max)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional(),
});

export const reportProblemSchema = z.object({
  reason: z.enum(PROBLEM_REASONS),
  details: z
    .string()
    .trim()
    .min(LIMITS.problemDetails.min, "Say what happened, in a sentence or two.")
    .max(LIMITS.problemDetails.max),
});
export type ReportProblemInput = z.infer<typeof reportProblemSchema>;
