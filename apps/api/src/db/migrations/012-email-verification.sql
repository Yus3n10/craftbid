-- Email verification.
--
-- Craftbid needs to know an account belongs to a real person who can be
-- reached, so a new account proves its address by following a link sent to
-- it. email_verified_at is when that happened.
--
-- Existing accounts are left NULL: none of them ever proved an address. They
-- keep signing in, and are asked to verify before they can post, bid, react,
-- comment, save or share. Nobody is locked out by this migration, and nothing
-- is enforced until the API has an email service configured to send links.

ALTER TABLE users ADD (email_verified_at TIMESTAMP WITH TIME ZONE);

-- Only the SHA-256 of a link's token is stored, like refresh tokens: a copy of
-- this table cannot be turned into working links. A token is single-use and
-- expires. `persistent` carries the "Keep me logged in" choice made at sign-up
-- to the session the link starts.
CREATE TABLE email_verification_tokens (
  id         RAW(16)                  NOT NULL,
  user_id    RAW(16)                  NOT NULL,
  token_hash VARCHAR2(64 CHAR)        NOT NULL,
  persistent NUMBER(1)                DEFAULT 0 NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at    TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_email_verification_tokens PRIMARY KEY (id),
  CONSTRAINT uq_email_verification_hash UNIQUE (token_hash),
  CONSTRAINT fk_email_verification_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_email_verification_persistent CHECK (persistent IN (0, 1))
);

-- Resend limits count a person's recent links.
CREATE INDEX ix_email_verification_user ON email_verification_tokens (user_id, created_at);
