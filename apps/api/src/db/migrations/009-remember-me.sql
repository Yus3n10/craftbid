-- "Keep me logged in".
--
-- Whether a session outlives the browser is a property of the session, not of
-- one request, so it lives on the refresh token. A refresh rotates the token,
-- and the replacement has to inherit the choice: read from the cookie it could
-- not be, because the server cannot see whether a cookie arrived as a session
-- cookie or a persistent one.
--
-- Existing rows default to 1. Every session issued before this migration was
-- given a 30-day persistent cookie, so 1 describes them truthfully and nobody
-- already signed in is signed out by the change.

ALTER TABLE refresh_tokens ADD (
  persistent NUMBER(1) DEFAULT 1 NOT NULL,
  CONSTRAINT ck_refresh_tokens_persistent CHECK (persistent IN (0, 1))
);
