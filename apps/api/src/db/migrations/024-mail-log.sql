-- A record of every outbound email and what became of it.
--
-- A send that fails is otherwise invisible: the person is told to check an
-- inbox nothing will arrive in, and the only trace is a log line nobody reads.
-- An expired Brevo key went unnoticed for days that way.
--
-- What is stored is deliberately thin. The subject and the recipient say which
-- message this was; the body is never stored, because a verification or reset
-- email carries a link that is enough to take the account over, and a copy of
-- this table would then be a copy of every live link.

CREATE TABLE mail_log (
  id         RAW(16)                  NOT NULL,
  kind       VARCHAR2(40 CHAR)        NOT NULL,
  recipient  VARCHAR2(320 CHAR)       NOT NULL,
  subject    VARCHAR2(200 CHAR)       NOT NULL,
  status     VARCHAR2(10 CHAR)        NOT NULL,
  -- The driver's own reason, trimmed. Never the request that produced it: it
  -- carries the API key in a header.
  error      VARCHAR2(500 CHAR),
  driver     VARCHAR2(20 CHAR)        NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_mail_log PRIMARY KEY (id),
  CONSTRAINT ck_mail_log_status CHECK (status IN ('sent', 'failed')),
  -- A failure says why; a success has nothing to explain.
  CONSTRAINT ck_mail_log_error CHECK ((status = 'failed') OR (error IS NULL))
);

-- "What failed today", and the pruning of old rows, both read by time.
CREATE INDEX ix_mail_log_created ON mail_log (created_at DESC);
