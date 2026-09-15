import type {
  ApplicationStatus,
  CommissionStatus,
  ConversationSummaryDto,
  MessageDto,
  PostingStatus,
  UserRole,
  UserSummaryDto,
} from "@craftbid/shared";
import { bufToUuid, newId, uuidToBuf } from "../../db/ids.js";
import { db, type BindValue, type Queryable } from "../../db/query.js";
import { imageFrom } from "../users/profiles.repository.js";

/**
 * Everything that decides who may be in a conversation and whether it is
 * still open: the request, the bid by that artist, and the commission if the
 * bid became one. Read fresh on every request, never cached on the row.
 */
export interface ChatAccess {
  postingId: string;
  postingTitle: string;
  postingStatus: PostingStatus;
  clientId: string;
  artistId: string;
  applicationStatus: ApplicationStatus;
  commissionId: string | null;
  commissionStatus: CommissionStatus | null;
}

interface AccessRow {
  postingId: Buffer;
  postingTitle: string;
  postingStatus: PostingStatus;
  clientId: Buffer;
  artistId: Buffer;
  applicationStatus: ApplicationStatus;
  commissionId: Buffer | null;
  commissionStatus: CommissionStatus | null;
}

const ACCESS_SELECT = `
  SELECT p.id AS posting_id, p.title AS posting_title, p.status AS posting_status,
         p.client_id, a.artist_id, a.status AS application_status,
         cm.id AS commission_id, cm.status AS commission_status
    FROM postings p
    JOIN applications a ON a.posting_id = p.id
    LEFT JOIN commissions cm ON cm.posting_id = p.id AND cm.artist_id = a.artist_id
`;

function mapAccess(row: AccessRow): ChatAccess {
  return {
    postingId: bufToUuid(row.postingId)!,
    postingTitle: row.postingTitle,
    postingStatus: row.postingStatus,
    clientId: bufToUuid(row.clientId)!,
    artistId: bufToUuid(row.artistId)!,
    applicationStatus: row.applicationStatus,
    commissionId: bufToUuid(row.commissionId),
    commissionStatus: row.commissionStatus,
  };
}

/** The request and the artist's bid on it, or null when there is no such bid. */
export async function findAccess(postingId: string, artistId: string, q: Queryable = db): Promise<ChatAccess | null> {
  const row = await q.one<AccessRow>(`${ACCESS_SELECT} WHERE p.id = :postingId AND a.artist_id = :artistId`, {
    postingId: uuidToBuf(postingId),
    artistId: uuidToBuf(artistId),
  });
  return row ? mapAccess(row) : null;
}

/** A conversation and its current access, or null when it does not exist. */
export async function findConversation(
  id: string,
  q: Queryable = db,
): Promise<(ChatAccess & { id: string }) | null> {
  const row = await q.one<AccessRow & { id: Buffer }>(
    `SELECT c.id, x.* FROM conversations c
       JOIN (${ACCESS_SELECT}) x ON x.posting_id = c.posting_id AND x.artist_id = c.artist_id
      WHERE c.id = :id`,
    { id: uuidToBuf(id) },
  );
  return row ? { id: bufToUuid(row.id)!, ...mapAccess(row) } : null;
}

export async function findIdByPair(postingId: string, artistId: string, q: Queryable = db): Promise<string | null> {
  const row = await q.one<{ id: Buffer }>(
    `SELECT id FROM conversations WHERE posting_id = :postingId AND artist_id = :artistId`,
    { postingId: uuidToBuf(postingId), artistId: uuidToBuf(artistId) },
  );
  return row ? bufToUuid(row.id) : null;
}

export async function insertConversation(access: ChatAccess, q: Queryable = db): Promise<string> {
  const id = newId();
  await q.run(
    `INSERT INTO conversations (id, posting_id, client_id, artist_id)
     VALUES (:id, :postingId, :clientId, :artistId)`,
    {
      id: uuidToBuf(id),
      postingId: uuidToBuf(access.postingId),
      clientId: uuidToBuf(access.clientId),
      artistId: uuidToBuf(access.artistId),
    },
  );
  return id;
}

interface SummaryRow {
  id: Buffer;
  username: string;
  displayName: string;
  role: UserRole;
  region: string | null;
  city: string | null;
  avatarId: Buffer | null;
  avatarKey: string | null;
  avatarWidth: number | null;
  avatarHeight: number | null;
}

function mapSummary(row: SummaryRow): UserSummaryDto {
  return {
    id: bufToUuid(row.id)!,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    avatar: imageFrom(row.avatarId, row.avatarKey, row.avatarWidth, row.avatarHeight),
    ...(row.region ? { region: row.region } : {}),
    ...(row.city ? { city: row.city } : {}),
  };
}

export async function userSummary(userId: string, q: Queryable = db): Promise<UserSummaryDto | null> {
  const row = await q.one<SummaryRow>(
    `SELECT u.id, u.username,
            CASE WHEN u.status = 'deleted' THEN 'Removed account' ELSE u.display_name END AS display_name,
            u.role, u.region, u.city,
            av.id AS avatar_id, av.object_key AS avatar_key, av.width AS avatar_width, av.height AS avatar_height
       FROM users u LEFT JOIN images av ON av.id = u.avatar_image_id
      WHERE u.id = :id`,
    { id: uuidToBuf(userId) },
  );
  return row ? mapSummary(row) : null;
}

interface MessageRow {
  id: Buffer;
  body: string | null;
  createdAt: Date;
  senderId: Buffer;
  fileId: Buffer | null;
  fileWidth: number | null;
  fileHeight: number | null;
}

/** A message's columns with its image's size, from messages `m` and chat_files `f`. */
const MESSAGE_COLUMNS = `m.id, m.body, m.created_at, m.sender_id,
  m.file_id, f.width AS file_width, f.height AS file_height`;
const MESSAGE_FROM = `messages m LEFT JOIN chat_files f ON f.id = m.file_id`;

function mapMessage(row: MessageRow, viewerId: string): MessageDto {
  const fileId = bufToUuid(row.fileId);
  return {
    id: bufToUuid(row.id)!,
    // A string even for an image on its own, so a page built before images
    // existed renders an empty caption rather than failing on null.
    body: row.body ?? "",
    createdAt: row.createdAt.toISOString(),
    mine: bufToUuid(row.senderId) === viewerId,
    ...(fileId ? { image: { fileId, width: Number(row.fileWidth), height: Number(row.fileHeight) } } : {}),
  };
}

export interface ChatFileRecord {
  id: string;
  conversationId: string;
  uploaderId: string;
  objectKey: string;
  contentType: string;
  attached: boolean;
}

export async function insertFile(
  file: {
    id: string;
    conversationId: string;
    uploaderId: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
    width: number;
    height: number;
  },
  q: Queryable = db,
): Promise<void> {
  await q.run(
    `INSERT INTO chat_files (id, conversation_id, uploader_id, object_key, content_type, byte_size, width, height)
     VALUES (:id, :conversationId, :uploaderId, :objectKey, :contentType, :byteSize, :width, :height)`,
    {
      id: uuidToBuf(file.id),
      conversationId: uuidToBuf(file.conversationId),
      uploaderId: uuidToBuf(file.uploaderId),
      objectKey: file.objectKey,
      contentType: file.contentType,
      byteSize: file.byteSize,
      width: file.width,
      height: file.height,
    },
  );
}

export async function findFile(fileId: string, q: Queryable = db): Promise<ChatFileRecord | null> {
  const row = await q.one<{
    id: Buffer;
    conversationId: Buffer;
    uploaderId: Buffer;
    objectKey: string;
    contentType: string;
    attached: number;
  }>(
    `SELECT f.id, f.conversation_id, f.uploader_id, f.object_key, f.content_type,
            CASE WHEN EXISTS (SELECT 1 FROM messages m WHERE m.file_id = f.id) THEN 1 ELSE 0 END AS attached
       FROM chat_files f
      WHERE f.id = :id`,
    { id: uuidToBuf(fileId) },
  );
  if (!row) return null;
  return {
    id: bufToUuid(row.id)!,
    conversationId: bufToUuid(row.conversationId)!,
    uploaderId: bufToUuid(row.uploaderId)!,
    objectKey: row.objectKey,
    contentType: row.contentType,
    attached: row.attached === 1,
  };
}

/** How many of the latest messages a conversation opens with. */
const HISTORY_LIMIT = 200;

/**
 * Oldest first. With `after`, only messages at or after that moment: a poll
 * passes the time of the newest message it holds, and may get that one back,
 * which the page drops by id. Millisecond times from the page against
 * microsecond times here make "at or after" the safe side to err on.
 */
export async function listMessages(
  conversationId: string,
  viewerId: string,
  after: Date | undefined,
  q: Queryable = db,
): Promise<MessageDto[]> {
  const binds: Record<string, BindValue> = { id: uuidToBuf(conversationId) };
  let rows: MessageRow[];
  if (after) {
    binds.after = after;
    rows = await q.many<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM ${MESSAGE_FROM}
        WHERE m.conversation_id = :id AND m.created_at >= :after
        ORDER BY m.created_at, m.id`,
      binds,
    );
  } else {
    rows = await q.many<MessageRow>(
      `SELECT * FROM (
         SELECT ${MESSAGE_COLUMNS} FROM ${MESSAGE_FROM}
          WHERE m.conversation_id = :id
          ORDER BY m.created_at DESC, m.id DESC
          FETCH FIRST ${HISTORY_LIMIT} ROWS ONLY
       ) ORDER BY created_at, id`,
      binds,
    );
  }
  return rows.map((row) => mapMessage(row, viewerId));
}

export async function insertMessage(
  conversationId: string,
  senderId: string,
  senderRole: "client" | "artist",
  content: { body: string | null; fileId: string | null },
  tx: Queryable,
): Promise<MessageDto> {
  const id = newId();
  await tx.run(
    `INSERT INTO messages (id, conversation_id, sender_id, body, file_id)
     VALUES (:id, :conversationId, :senderId, :body, :fileId)`,
    {
      id: uuidToBuf(id),
      conversationId: uuidToBuf(conversationId),
      senderId: uuidToBuf(senderId),
      body: content.body,
      fileId: content.fileId ? uuidToBuf(content.fileId) : null,
    },
  );
  // Sending counts as having read everything up to your own message. The
  // column is one of two literals, never from the request.
  const readColumn = senderRole === "client" ? "client_last_read_at" : "artist_last_read_at";
  await tx.run(
    `UPDATE conversations SET last_message_at = SYSTIMESTAMP, ${readColumn} = SYSTIMESTAMP WHERE id = :id`,
    { id: uuidToBuf(conversationId) },
  );
  const row = await tx.one<MessageRow>(`SELECT ${MESSAGE_COLUMNS} FROM ${MESSAGE_FROM} WHERE m.id = :id`, {
    id: uuidToBuf(id),
  });
  return mapMessage(row!, senderId);
}

export async function markRead(conversationId: string, role: "client" | "artist", q: Queryable = db): Promise<void> {
  const readColumn = role === "client" ? "client_last_read_at" : "artist_last_read_at";
  await q.run(`UPDATE conversations SET ${readColumn} = SYSTIMESTAMP WHERE id = :id`, {
    id: uuidToBuf(conversationId),
  });
}

/**
 * Whether the other person wrote something after this person last read. The
 * same expression serves the list and the count, so they cannot disagree.
 */
const UNREAD_FOR_VIEWER = `
  EXISTS (
    SELECT 1 FROM messages m
     WHERE m.conversation_id = c.id AND m.sender_id <> :viewer
       AND m.created_at > NVL(
             CASE WHEN c.client_id = :viewer THEN c.client_last_read_at ELSE c.artist_last_read_at END,
             TIMESTAMP '1970-01-01 00:00:00 UTC')
  )`;

export async function unreadCount(viewerId: string, q: Queryable = db): Promise<number> {
  const row = await q.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM conversations c
      WHERE (c.client_id = :viewer OR c.artist_id = :viewer) AND ${UNREAD_FOR_VIEWER}`,
    { viewer: uuidToBuf(viewerId) },
  );
  return Number(row?.cnt ?? 0);
}

/** A person's conversations that have at least one message, newest first. */
export async function listForUser(viewerId: string, q: Queryable = db): Promise<ConversationSummaryDto[]> {
  const viewer = uuidToBuf(viewerId);
  const rows = await q.many<{
    id: Buffer;
    postingId: Buffer;
    postingTitle: string;
    clientId: Buffer;
    artistId: Buffer;
    unread: number;
  }>(
    `SELECT c.id, c.posting_id, p.title AS posting_title, c.client_id, c.artist_id,
            CASE WHEN ${UNREAD_FOR_VIEWER} THEN 1 ELSE 0 END AS unread
       FROM conversations c
       JOIN postings p ON p.id = c.posting_id
      WHERE (c.client_id = :viewer OR c.artist_id = :viewer) AND c.last_message_at IS NOT NULL
      ORDER BY c.last_message_at DESC
      FETCH FIRST 100 ROWS ONLY`,
    { viewer },
  );
  if (rows.length === 0) return [];

  const binds: Record<string, BindValue> = {};
  const placeholders = rows.map((row, index) => {
    binds[`c${index}`] = row.id;
    return `:c${index}`;
  });
  const [lastMessages, people] = await Promise.all([
    q.many<MessageRow & { conversationId: Buffer }>(
      `SELECT conversation_id, id, body, created_at, sender_id, file_id FROM (
         SELECT m.conversation_id, m.id, m.body, m.created_at, m.sender_id, m.file_id,
                ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at DESC, m.id DESC) AS rn
           FROM messages m
          WHERE m.conversation_id IN (${placeholders.join(", ")})
       ) WHERE rn = 1`,
      binds,
    ),
    Promise.all(
      rows.map((row) => userSummary(bufToUuid(row.clientId) === viewerId ? bufToUuid(row.artistId)! : bufToUuid(row.clientId)!, q)),
    ),
  ]);
  const lastById = new Map(lastMessages.map((row) => [bufToUuid(row.conversationId)!, row]));

  return rows.flatMap((row, index) => {
    const id = bufToUuid(row.id)!;
    const last = lastById.get(id);
    const other = people[index];
    if (!last || !other) return [];
    return [
      {
        id,
        posting: { id: bufToUuid(row.postingId)!, title: row.postingTitle },
        otherParty: other,
        myRole: bufToUuid(row.clientId) === viewerId ? ("client" as const) : ("artist" as const),
        lastMessage: {
          body: last.body ?? "",
          createdAt: last.createdAt.toISOString(),
          mine: bufToUuid(last.senderId) === viewerId,
          ...(last.fileId ? { hasImage: true } : {}),
        },
        unread: row.unread === 1,
      },
    ];
  });
}
