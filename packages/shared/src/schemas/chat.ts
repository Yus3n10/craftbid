import { z } from "zod";
import { LIMITS } from "../constants.js";
import { uuidSchema } from "./common.js";

/** Opens, or returns, the conversation about one request with one artist. */
export const openConversationSchema = z.object({
  postingId: uuidSchema,
  artistId: uuidSchema,
});

export const sendMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a message first.")
    .max(LIMITS.messageBody.max, `Messages can be up to ${LIMITS.messageBody.max} characters.`),
});

/** A poll asks only for what arrived since the last message it has. */
export const messagesQuerySchema = z.object({
  after: z.string().datetime({ offset: true }).optional(),
});

export type OpenConversationInput = z.infer<typeof openConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
