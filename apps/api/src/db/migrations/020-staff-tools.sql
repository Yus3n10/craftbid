-- Staff tools: scheduled jobs, the unread-chat notice, and the admin screen's
-- commission problems and payment records.

-- A scheduled job claims each run by inserting its key (the day, for the daily
-- summary). A second tick, or a restart, finds the key taken and does nothing,
-- so every job is safe to run more than once.
CREATE TABLE job_runs (
  name    VARCHAR2(40 CHAR)        NOT NULL,
  run_key VARCHAR2(40 CHAR)        NOT NULL,
  ran_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_job_runs PRIMARY KEY (name, run_key)
);

-- For the unread-chat notice: each side's last-read time as it was when that
-- side was last told about an unread message. While it still matches, the side
-- has not read since and is not told again; once they read, it no longer
-- matches, and the next message left unread for an hour tells them once more.
-- Comparing read times rather than clock times keeps this exact on any clock.
ALTER TABLE conversations ADD (
  client_nudged_for_read TIMESTAMP WITH TIME ZONE,
  artist_nudged_for_read TIMESTAMP WITH TIME ZONE
);

-- Resolving a commission problem, and opening a payment receipt, are on the record.
ALTER TABLE moderation_actions DROP CONSTRAINT ck_moderation_actions_action;
ALTER TABLE moderation_actions ADD CONSTRAINT ck_moderation_actions_action CHECK (action IN
  ('warn', 'suspend', 'unsuspend', 'remove_account', 'remove_post',
   'remove_posting', 'remove_comment', 'resolve_report', 'dismiss_report',
   'resolve_bug', 'resolve_problem', 'payment_file_viewed'));

ALTER TABLE moderation_actions DROP CONSTRAINT ck_moderation_actions_target;
ALTER TABLE moderation_actions ADD CONSTRAINT ck_moderation_actions_target CHECK (target_type IN
  ('user', 'artist_post', 'posting', 'comment', 'report', 'bug_report', 'problem', 'payment'));

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_type;
ALTER TABLE notifications ADD CONSTRAINT ck_notifications_type CHECK (type IN
  ('application_received', 'application_accepted', 'application_rejected',
   'commission_completed', 'review_received',
   'post_reaction', 'post_comment',
   'payment_submitted', 'payment_confirmed', 'payment_rejected',
   'work_finished', 'commission_shipped', 'problem_reported', 'problem_closed',
   'post_shared', 'balance_method_chosen',
   'account_warning', 'content_removed',
   'share_reaction', 'share_comment',
   'chat_unread'));
