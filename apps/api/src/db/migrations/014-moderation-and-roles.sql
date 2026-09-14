-- Moderation, bug reports, and switching between artist and client.
--
-- Additive only: every existing row stays valid, so this can run on
-- production before the code that uses it is deployed.

ALTER TABLE users ADD (
  is_staff        NUMBER(1) DEFAULT 0 NOT NULL,
  role_changed_at TIMESTAMP WITH TIME ZONE
);
ALTER TABLE users ADD CONSTRAINT ck_users_is_staff CHECK (is_staff IN (0, 1));

-- Comments become reportable, and a report records who closed it and why.
ALTER TABLE reports DROP CONSTRAINT ck_reports_target_type;
ALTER TABLE reports ADD CONSTRAINT ck_reports_target_type CHECK (target_type IN
  ('posting', 'user', 'artist_post', 'application', 'comment'));
ALTER TABLE reports ADD (
  resolved_by     RAW(16),
  resolved_at     TIMESTAMP WITH TIME ZONE,
  resolution_note VARCHAR2(1000 CHAR)
);
ALTER TABLE reports ADD CONSTRAINT fk_reports_resolved_by
  FOREIGN KEY (resolved_by) REFERENCES users (id);

-- A comment removed by staff is kept as evidence and hidden everywhere else.
ALTER TABLE post_comments ADD (
  removed_at TIMESTAMP WITH TIME ZONE,
  removed_by RAW(16)
);
ALTER TABLE post_comments ADD CONSTRAINT fk_post_comments_removed_by
  FOREIGN KEY (removed_by) REFERENCES users (id);

ALTER TABLE postings ADD (removed_at TIMESTAMP WITH TIME ZONE);

CREATE TABLE bug_reports (
  id              RAW(16)                  NOT NULL,
  reporter_id     RAW(16)                  NOT NULL,
  description     VARCHAR2(2000 CHAR)      NOT NULL,
  page_url        VARCHAR2(500 CHAR),
  user_agent      VARCHAR2(500 CHAR),
  -- Private storage key; screenshots can show someone's personal details.
  screenshot_key  VARCHAR2(300 CHAR),
  status          VARCHAR2(10 CHAR)        DEFAULT 'open' NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  resolved_at     TIMESTAMP WITH TIME ZONE,
  resolved_by     RAW(16),
  CONSTRAINT pk_bug_reports PRIMARY KEY (id),
  CONSTRAINT fk_bug_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_bug_reports_resolved_by FOREIGN KEY (resolved_by) REFERENCES users (id),
  CONSTRAINT ck_bug_reports_status CHECK (status IN ('open', 'resolved'))
);
CREATE INDEX ix_bug_reports_triage ON bug_reports (status, created_at DESC);

-- The audit log. Nothing in the application updates or deletes these rows.
CREATE TABLE moderation_actions (
  id          RAW(16)                  NOT NULL,
  staff_id    RAW(16)                  NOT NULL,
  action      VARCHAR2(30 CHAR)        NOT NULL,
  target_type VARCHAR2(20 CHAR)        NOT NULL,
  target_id   RAW(16)                  NOT NULL,
  -- The account the action concerns, so an account's history is one lookup.
  subject_user_id RAW(16),
  rule        VARCHAR2(30 CHAR),
  note        VARCHAR2(1000 CHAR),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_moderation_actions PRIMARY KEY (id),
  CONSTRAINT fk_moderation_actions_staff FOREIGN KEY (staff_id) REFERENCES users (id),
  CONSTRAINT ck_moderation_actions_action CHECK (action IN
    ('warn', 'suspend', 'unsuspend', 'remove_account', 'remove_post',
     'remove_posting', 'remove_comment', 'resolve_report', 'dismiss_report',
     'resolve_bug')),
  CONSTRAINT ck_moderation_actions_target CHECK (target_type IN
    ('user', 'artist_post', 'posting', 'comment', 'report', 'bug_report')),
  CONSTRAINT ck_moderation_actions_rule CHECK (rule IS NULL OR rule IN
    ('bullying_harassment', 'sexual_content', 'hate_speech', 'violence_threats',
     'scam_fraud', 'spam', 'stolen_work', 'impersonation', 'other'))
);
CREATE INDEX ix_moderation_actions_time ON moderation_actions (created_at DESC);
CREATE INDEX ix_moderation_actions_subject ON moderation_actions (subject_user_id, created_at DESC);

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_type;
ALTER TABLE notifications ADD CONSTRAINT ck_notifications_type CHECK (type IN
  ('application_received', 'application_accepted', 'application_rejected',
   'commission_completed', 'review_received',
   'post_reaction', 'post_comment',
   'payment_submitted', 'payment_confirmed', 'payment_rejected',
   'work_finished', 'commission_shipped', 'problem_reported', 'problem_closed',
   'post_shared', 'balance_method_chosen',
   'account_warning', 'content_removed'));
