import type {
  ConversationDto,
  ConversationSummaryDto,
  MessageDto,
  OpenConversationInput,
} from "@craftbid/shared";
import { DbError, withTransaction } from "../../db/query.js";
import { badRequest, notFound } from "../../lib/errors.js";
import * as repo from "./chat.repository.js";

/**
 * Chat between a client and an artist about one craft request.
 *
 * Every rule reads the request, the bid and the commission as they are now.
 * Anyone who is not the client or that artist gets the same "not found" as a
 * conversation that does not exist, so ids cannot be probed for.
 */

const NOT_FOUND = "That conversation does not exist.";

function roleOf(access: repo.ChatAccess, userId: string): "client" | "artist" | null {
  if (access.clientId === userId) return "client";
  if (access.artistId === userId) return "artist";
  return null;
}

/**
 * Open while the bid is still being considered, or once it is a commission
 * that has not been cancelled. A declined or withdrawn bid, a cancelled
 * request or a cancelled commission leaves the history readable and closed.
 */
function stateOf(access: repo.ChatAccess): Pick<ConversationDto, "stage" | "commissionId" | "canSend"> {
  if (access.applicationStatus === "accepted" && access.commissionId) {
    return {
      stage: "commission",
      commissionId: access.commissionId,
      canSend: access.commissionStatus !== "cancelled",
    };
  }
  return {
    stage: "bidding",
    canSend: access.applicationStatus === "pending" && access.postingStatus === "open",
  };
}

async function load(conversationId: string, userId: string) {
  const conversation = await repo.findConversation(conversationId);
  const role = conversation ? roleOf(conversation, userId) : null;
  if (!conversation || !role) throw notFound(NOT_FOUND);
  return { conversation, role };
}

async function toDto(conversation: repo.ChatAccess & { id: string }, role: "client" | "artist"): Promise<ConversationDto> {
  const other = await repo.userSummary(role === "client" ? conversation.artistId : conversation.clientId);
  if (!other) throw notFound(NOT_FOUND);
  return {
    id: conversation.id,
    posting: { id: conversation.postingId, title: conversation.postingTitle },
    otherParty: other,
    myRole: role,
    ...stateOf(conversation),
  };
}

/**
 * The conversation about a request with one artist, created the first time
 * either of them opens it. Only the client who posted the request, or the
 * artist named, and only when that artist has bid on it.
 */
export async function open(userId: string, input: OpenConversationInput): Promise<ConversationDto> {
  const access = await repo.findAccess(input.postingId, input.artistId);
  const role = access ? roleOf(access, userId) : null;
  if (!access || !role) throw notFound(NOT_FOUND);

  let id = await repo.findIdByPair(access.postingId, access.artistId);
  if (!id) {
    try {
      id = await withTransaction((tx) => repo.insertConversation(access, tx));
    } catch (error) {
      // Both people opened it at the same moment: use the one that won.
      if (!(error instanceof DbError && error.isUniqueViolation)) throw error;
      id = await repo.findIdByPair(access.postingId, access.artistId);
      if (!id) throw error;
    }
  }
  return get(userId, id);
}

export async function get(userId: string, conversationId: string): Promise<ConversationDto> {
  const { conversation, role } = await load(conversationId, userId);
  return toDto(conversation, role);
}

export async function messages(userId: string, conversationId: string, after?: string): Promise<MessageDto[]> {
  await load(conversationId, userId);
  return repo.listMessages(conversationId, userId, after ? new Date(after) : undefined);
}

export async function send(userId: string, conversationId: string, body: string): Promise<MessageDto> {
  const { conversation, role } = await load(conversationId, userId);
  if (!stateOf(conversation).canSend) {
    throw badRequest(
      conversation.applicationStatus === "accepted"
        ? "This commission was cancelled, so the conversation is closed. You can still read it."
        : "This bid is no longer open, so the conversation is closed. You can still read it.",
    );
  }
  return withTransaction((tx) => repo.insertMessage(conversationId, userId, role, body, tx));
}

export async function markRead(userId: string, conversationId: string): Promise<void> {
  const { role } = await load(conversationId, userId);
  await repo.markRead(conversationId, role);
}

export function list(userId: string): Promise<ConversationSummaryDto[]> {
  return repo.listForUser(userId);
}

export function unread(userId: string): Promise<number> {
  return repo.unreadCount(userId);
}
