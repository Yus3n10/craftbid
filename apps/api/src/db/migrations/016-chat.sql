-- Chat between a client and an artist about one craft request.
--
-- A conversation belongs to a request and one artist who bid on it, so there
-- is at most one per pair and nobody else can be in it. When that artist is
-- chosen, the same conversation carries on through the commission: the
-- commission is found through the request, so nothing moves.
--
-- Who may read or write is decided by the API against the bid and the
-- commission. The table only holds the pair, the messages, and when each side
-- last read, which is what the unread count is made of.

CREATE TABLE conversations (
  id                  RAW(16)                  NOT NULL,
  posting_id          RAW(16)                  NOT NULL,
  client_id           RAW(16)                  NOT NULL,
  artist_id           RAW(16)                  NOT NULL,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  last_message_at     TIMESTAMP WITH TIME ZONE,
  client_last_read_at TIMESTAMP WITH TIME ZONE,
  artist_last_read_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT pk_conversations PRIMARY KEY (id),
  CONSTRAINT fk_conversations_posting FOREIGN KEY (posting_id) REFERENCES postings (id) ON DELETE CASCADE,
  CONSTRAINT fk_conversations_client FOREIGN KEY (client_id) REFERENCES users (id),
  CONSTRAINT fk_conversations_artist FOREIGN KEY (artist_id) REFERENCES users (id),
  -- One conversation per request per artist, so opening it twice, or from both
  -- sides at once, lands in the same place.
  CONSTRAINT uq_conversations_posting_artist UNIQUE (posting_id, artist_id),
  CONSTRAINT ck_conversations_parties CHECK (client_id <> artist_id)
);

CREATE INDEX ix_conversations_client ON conversations (client_id, last_message_at DESC);
CREATE INDEX ix_conversations_artist ON conversations (artist_id, last_message_at DESC);

CREATE TABLE messages (
  id              RAW(16)                  NOT NULL,
  conversation_id RAW(16)                  NOT NULL,
  sender_id       RAW(16)                  NOT NULL,
  body            VARCHAR2(2000 CHAR)      NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_messages PRIMARY KEY (id),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users (id),
  CONSTRAINT ck_messages_body CHECK (LENGTH(TRIM(body)) > 0)
);

CREATE INDEX ix_messages_conversation ON messages (conversation_id, created_at);
