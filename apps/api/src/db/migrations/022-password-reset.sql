-- Password reset.
--
-- A reset works like email verification: a single-use link sent to the account's
-- address, of which only the SHA-256 is stored, so a copy of this table cannot
-- be turned into working links. Links are short-lived because holding one is
-- enough to take over the account.

CREATE TABLE password_reset_tokens (
  id         RAW(16)                  NOT NULL,
  user_id    RAW(16)                  NOT NULL,
  token_hash VARCHAR2(64 CHAR)        NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at    TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_password_reset_tokens PRIMARY KEY (id),
  CONSTRAINT uq_password_reset_hash UNIQUE (token_hash),
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Sending limits count a person's recent links.
CREATE INDEX ix_password_reset_user ON password_reset_tokens (user_id, created_at);
