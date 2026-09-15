import { z } from "zod";
import { LIMITS } from "../constants.js";
import { uuidSchema } from "./common.js";

/** Opens, or returns, the conversation about one request with one artist. */
export const openConversationSchema = z.object({
  postingId: uuidSchema,
  artistId: uuidSchema,
});

/**
 * Text, an image uploaded to this conversation, or both. Blank text counts as
 * none, so a message must carry something.
 */
export const sendMessageSchema = z
  .object({
    body: z
      .string()
      .trim()
      .max(LIMITS.messageBody.max, `Messages can be up to ${LIMITS.messageBody.max} characters.`)
      .optional()
      .transform((value) => (value ? value : undefined)),
    fileId: uuidSchema.optional(),
  })
  .refine((message) => message.body !== undefined || message.fileId !== undefined, {
    message: "Write a message first.",
    path: ["body"],
  });

/** A poll asks only for what arrived since the last message it has. */
export const messagesQuerySchema = z.object({
  after: z.string().datetime({ offset: true }).optional(),
});

export type OpenConversationInput = z.infer<typeof openConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
