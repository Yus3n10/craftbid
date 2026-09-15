-- Images in chat.
--
-- A message now carries text, an image, or both. The image is a private file
-- that only the conversation's client and artist can open, stored under the
-- conversation like receipts are stored under their commission.
--
-- The file is uploaded first and attached when the message is sent, so a
-- message never exists pointing at an upload that failed. A file is attached
-- to at most one message; one left unattached is cleaned up later.

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
ALTER TABLE messages ADD CONSTRAINT fk_messages_file
  FOREIGN KEY (file_id) REFERENCES chat_files (id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT uq_messages_file UNIQUE (file_id);

-- Oracle stores an empty string as NULL, so "no text" is NULL here.
ALTER TABLE messages DROP CONSTRAINT ck_messages_body;
ALTER TABLE messages ADD CONSTRAINT ck_messages_content CHECK (
  (body IS NOT NULL AND LENGTH(TRIM(body)) > 0) OR file_id IS NOT NULL
);
