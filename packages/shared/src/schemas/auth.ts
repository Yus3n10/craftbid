import { z } from "zod";
import { LIMITS, USER_ROLES } from "../constants.js";

/**
 * Usernames are stored lowercase and are the artist's public handle. Restricted
 * to an unambiguous character set so profile URLs stay predictable.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.username.min)
  .max(LIMITS.username.max)
  .regex(
    /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/,
    "Use letters, numbers, hyphens and underscores. Must start and end with a letter or number.",
  );

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(255);

/**
 * Length is the only strength rule. Composition rules ("must contain a symbol")
 * push people toward predictable substitutions without adding real entropy;
 * NIST 800-63B advises against them.
 */
export const passwordSchema = z
  .string()
  .min(LIMITS.password.min, `Use at least ${LIMITS.password.min} characters.`)
  .max(LIMITS.password.max);

/**
 * "Keep me logged in". Absent means no, so the default is the session that
 * ends with the browser, and a client that never sends the field (an older
 * build, a script) gets the safer behaviour rather than a 30-day one.
 */
export const rememberSchema = z.boolean().optional();

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  displayName: z
    .string()
    .trim()
    .min(LIMITS.displayName.min)
    .max(LIMITS.displayName.max),
  role: z.enum(USER_ROLES),
  remember: rememberSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
  remember: rememberSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
