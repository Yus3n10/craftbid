-- Trust and safety hooks, plus in-app notifications.
--
-- Deliberately minimal. The brief asked for sensible extension points rather
-- than a moderation system, so this is a place for reports to land and a queue
-- for in-app notices. There is no email or SMS anywhere in the product: both
-- cost money at volume, and the budget is zero.

CREATE TABLE reports (
  id          RAW(16)                  NOT NULL,
  reporter_id RAW(16)                  NOT NULL,
  target_type VARCHAR2(20 CHAR)        NOT NULL,
  -- Intentionally not a foreign key: one column points at four different
  -- tables. The route validates that the target exists before inserting.
  target_id   RAW(16)                  NOT NULL,
  reason      VARCHAR2(30 CHAR)        NOT NULL,
  details     VARCHAR2(1000 CHAR),
  status      VARCHAR2(20 CHAR)        DEFAULT 'open' NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_reports PRIMARY KEY (id),
  CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_reports_target_type CHECK (target_type IN ('posting', 'user', 'artist_post', 'application')),
  CONSTRAINT ck_reports_reason CHECK (reason IN
    ('spam', 'inappropriate', 'scam', 'harassment', 'stolen_work', 'other')),
  CONSTRAINT ck_reports_status CHECK (status IN ('open', 'reviewed', 'dismissed')),
  -- One open report per person per target, so a single user cannot inflate the
  -- queue against someone by filing the same complaint repeatedly.
  CONSTRAINT uq_reports_reporter_target UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX ix_reports_triage ON reports (status, created_at DESC);

CREATE TABLE notifications (
  id         RAW(16)                  NOT NULL,
  user_id    RAW(16)                  NOT NULL,
  type       VARCHAR2(40 CHAR)        NOT NULL,
  payload    CLOB                     NOT NULL,
  read_at    TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_notifications PRIMARY KEY (id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_notifications_type CHECK (type IN
    ('application_received', 'application_accepted', 'application_rejected',
     'commission_completed', 'review_received')),
  -- Guarantees the payload is parseable before it reaches the client.
  CONSTRAINT ck_notifications_payload_json CHECK (payload IS JSON)
);

-- The unread badge and the notification list are both "this user, newest first".
CREATE INDEX ix_notifications_user ON notifications (user_id, created_at DESC);
