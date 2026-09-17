# Batch 3: Images in Chat Implementation Plan

**Goal:** Let the two people in a conversation send one image per message (attach or paste), shrunk in the browser before upload, stored privately and visible only to them.

**Architecture:** Migration 019 adds `chat_files` and lets a message carry a file instead of text. Upload is a separate multipart call returning a file id, which the existing send call attaches. The server reuses `normaliseImage` (magic bytes, sharp re-encode, EXIF dropped) capped at 1600px, stores with `putPrivate`, and streams back through a membership-checked route. The browser compresses with a canvas before upload. `PrivateImage` is generalised to any private API path.

**Tech Stack:** Fastify multipart, sharp, ImageKit private files (memory storage in tests), React, canvas `toBlob`, Playwright, Vitest on Oracle.

**Spec:** `docs/superpowers/specs/2026-09-15-fixes-feed-chat-images-staff-tools-design.md` (Batch 3)

## Global Constraints

- Only the conversation's client and artist can upload, attach or view; everyone else gets 404, as with every chat route.
- Uploads only while the conversation `canSend`. One image per message; optional text.
- Browser: refuse files over 15 MB before reading; longest side at most 1600px; WebP quality 0.8, JPEG 0.82 where WebP encoding is unsupported.
- Server: `normaliseImage` with a 1600px cap; key `conversations/<conversationId>/<fileId>.webp`; `private, no-store`.
- A file is attached once, by its uploader, to a message in its own conversation.
- `MessageDto.body` stays a string (`""` for an image-only message) so an older tab never meets `null` during the deploy gap.
- Unattached files older than 24 hours are cleaned by Batch 4's job runner, not here.
- Migration 019 runs on production before the push. No em dashes, no AI attribution, commit only when told.

---

### Task 1: Migration 019 and the API

**Files:**
- Create: `apps/api/src/db/migrations/019-chat-images.sql`
- Modify: `packages/shared/src/schemas/chat.ts` (`sendMessageSchema` body optional + `fileId` optional, at least one), `packages/shared/src/types.ts` (`MessageDto.image?`, `lastMessage.hasImage?`)
- Modify: `apps/api/src/modules/images/images.service.ts` (`normaliseImage(buffer, { maxSide })`)
- Modify: `apps/api/src/modules/chat/chat.repository.ts`, `chat.service.ts`, `chat.routes.ts`
- Modify: `apps/api/src/test/helpers.ts` (`resetData` deletes `messages` before `chat_files`)
- Modify: `apps/api/src/db/purge-accounts.ts` (collect and remove chat file objects)
- Test: `apps/api/src/test/chat-images.test.ts`

**Interfaces:**
- Produces:
  - `POST /conversations/:id/files` (multipart `file`) → 201 `{ fileId: string; width: number; height: number }`
  - `POST /conversations/:id/messages` `{ body?: string; fileId?: string }` → 201 `MessageDto`
  - `GET /conversations/:id/files/:fileId` → image bytes, `private, no-store`
  - `MessageDto = { id; body: string; createdAt; mine; image?: { fileId: string; width: number; height: number } }`
  - `ConversationSummaryDto.lastMessage.hasImage?: boolean`

- [ ] **Step 1: Migration**

```sql
-- Images in chat. A message carries text, an image, or both; the image is a
-- private file only the conversation's two people can open.
CREATE TABLE chat_files (
  id              RAW(16)                  NOT NULL,
  conversation_id RAW(16)                  NOT NULL,
  uploader_id     RAW(16)                  NOT NULL,
  object_key      VARCHAR2(300 CHAR)       NOT NULL,
  content_type    VARCHAR2(50 CHAR)        NOT NULL,
  byte_size       NUMBER(10)               NOT NULL,
  width           NUMBER(5)                NOT NULL,
  height          NUMBER(5)                NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_chat_files PRIMARY KEY (id),
  CONSTRAINT fk_chat_files_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_files_uploader FOREIGN KEY (uploader_id) REFERENCES users (id)
);
CREATE INDEX ix_chat_files_conversation ON chat_files (conversation_id, created_at);

ALTER TABLE messages ADD (file_id RAW(16));
ALTER TABLE messages MODIFY (body NULL);
ALTER TABLE messages ADD CONSTRAINT fk_messages_file FOREIGN KEY (file_id) REFERENCES chat_files (id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT uq_messages_file UNIQUE (file_id);
ALTER TABLE messages DROP CONSTRAINT ck_messages_body;
ALTER TABLE messages ADD CONSTRAINT ck_messages_content CHECK (
  (body IS NOT NULL AND LENGTH(TRIM(body)) > 0) OR file_id IS NOT NULL
);
```

- [ ] **Step 2: Failing tests** (`chat-images.test.ts`), using the chat test's setup (client, artist who bid, conversation opened) and `testImage`/`multipartFile` helpers:
  - uploads a 3000x2000 PNG: 201, width 1600, height 1067; the private object is WebP; nothing in public storage.
  - sends an image-only message: 201, `body: ""`, `image.fileId`; the other party's message list shows it with dimensions; `GET .../files/:fileId` returns WebP with `cache-control: private, no-store` for both parties.
  - an image with a caption keeps the caption.
  - another bidding artist and a stranger get 404 uploading, and 404 reading the file.
  - attaching a file the other person uploaded: 400; a file from another conversation: 400; attaching the same file twice: 400.
  - a closed conversation (bid rejected) refuses an upload with 400.
  - a message with neither text nor file: 400 from the schema; inserting one directly is refused by `ck_messages_content`.
  - the conversation list preview has `hasImage: true` and `body: ""`.
  - deleting the conversation removes its files and messages (cascade).

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: `normaliseImage(buffer, options: { maxSide?: number } = {})`**, defaulting to 2000 so existing callers are unchanged.

- [ ] **Step 5: Repository**: `insertFile`, `findFile(fileId)` → `{ id, conversationId, uploaderId, objectKey, contentType, attached }`, `insertMessage(conversationId, senderId, role, body | null, fileId | null, tx)`, message selects `LEFT JOIN chat_files f ON f.id = m.file_id` returning `f.width, f.height`; `mapMessage` sets `body: row.body ?? ""` and `image` when `file_id` is present; `listForUser` last message gains `hasImage`.

- [ ] **Step 6: Service**: `uploadImage(userId, conversationId, buffer)` (load, `canSend` or 400, normalise at 1600, put private, insert, remove the object if the insert fails); `send(userId, conversationId, { body, fileId })` checks the file is in this conversation, uploaded by the sender, and not attached (400 "That image cannot be sent here."), and maps a `uq_messages_file` violation to the same 400; `readImage(userId, conversationId, fileId)`.

- [ ] **Step 7: Routes** mirroring `commission-payments.routes.ts` file routes, rate limit 20 per 10 minutes on upload.

- [ ] **Step 8: Purge script**: collect `SELECT object_key FROM chat_files WHERE conversation_id IN (the conversations it deletes)` before deleting, remove them after commit with `removePrivate`, and print the count in the dry run.

- [ ] **Step 9: Run → PASS.** Mutations: drop the uploader check in `send`; drop the conversation check in `readImage`; each fails a test.

### Task 2: Web

**Files:**
- Create: `apps/web/src/lib/compressImage.ts`
- Modify: `apps/web/src/components/commission/PrivateImage.tsx` (prop `path`), `apps/web/src/components/commission/PaymentPanel.tsx` (three callers), `apps/web/src/lib/api.ts` (drop `loadPrivateImage` if unused)
- Modify: `apps/web/src/pages/ConversationPage.tsx`, `apps/web/src/pages/MessagesPage.tsx`
- Modify: `apps/web/src/components/ui/Icons.tsx` (an image icon if none exists)
- Test: `apps/web/e2e-resilience/chat.spec.ts`

**Interfaces:**
- Produces: `compressForChat(file: Blob): Promise<Blob>` (throws `Error` with a readable message for non-images and files over 15 MB)

- [ ] **Step 1: Failing resilience tests**
  - Pasting a 3000x2000 PNG into the message box shows a preview with "Remove image"; Send uploads first (multipart part `image/webp`, parsed VP8 width 1600), then posts `{ fileId }` with no body; the sent bubble shows the image.
  - Attach button opens a file chooser (`setInputFiles`) with the same result, and text typed alongside is sent as `body`.
  - "Remove image" clears the preview and Send is disabled again with an empty box.
  - A received image message renders a thumbnail loaded from `/conversations/:id/files/:fileId`, opens full size, and the message list preview reads "Sent a photo".
  - At 320px with a preview showing, no horizontal overflow and the box stays in the viewport.
  - A closed conversation shows no attach button.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: `compressForChat`**

```ts
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 1600;

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  await image.decode();
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressForChat(file: Blob): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Only images can be sent.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("That image is over 15 MB. Choose a smaller one.");
  const decoded = await decode(file).catch(() => { throw new Error("That image could not be opened."); });
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    canvas.getContext("2d")!.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const webp = await encode(canvas, "image/webp", 0.8);
    if (webp && webp.type === "image/webp") return webp;
    const jpeg = await encode(canvas, "image/jpeg", 0.82);
    if (!jpeg) throw new Error("That image could not be prepared.");
    return jpeg;
  } finally {
    decoded.close();
  }
}
```

- [ ] **Step 4: `PrivateImage`** takes `path` and uses `loadPrivateUrl(path)`; PaymentPanel passes `/commissions/${id}/files/${fileId}`.

- [ ] **Step 5: `ConversationPage`**
  - State `pending: { file: Blob; previewUrl: string } | null`; `useUnsavedChanges(draft.trim() !== "" || pending !== null)`.
  - Attach button (image icon, `aria-label="Attach an image"`) beside the box, opening a hidden `<input type="file" accept="image/*">`.
  - `onPaste` on the textarea: the first `clipboardData.files` item whose type starts with `image/` becomes `pending` and `preventDefault()`; text pastes are untouched.
  - Preview row above the box: thumbnail (max-h-32, object-contain) and "Remove image".
  - Send: disabled unless text or `pending`; when `pending`, `compressForChat` → `postForm("/conversations/:id/files", form)` → `api.post(".../messages", { fileId, ...(body ? { body } : {}) })`; errors show in `FormError`; revoke the preview URL on send or remove.
  - Bubbles: `message.image` renders `PrivateImage` (path `/conversations/${id}/files/${fileId}`, width capped at 240px with aspect ratio from the dimensions) above the text; text bubble only when `body` is non-empty.
  - Replace `latest.current.at(-1)` with index access (older Safari lacks `Array.prototype.at`).
- [ ] **Step 6: `MessagesPage`** preview: `lastMessage.body || (lastMessage.hasImage ? "Sent a photo" : "")`.
- [ ] **Step 7: Run → PASS.**

### Task 3: Verification

- [ ] Add to `e2e/chat.spec.ts`: the client sends an image while bidding; after the bid is accepted, the artist opens the conversation from the commission and sees the image load.
- [ ] `pnpm typecheck`, API, resilience, worker, e2e; screenshots at 390px and 1280px with an image message and a preview.
- [ ] Re-seed. Report; production needs migration 019 first.
