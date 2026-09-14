-- Reactions and comments on a share, separate from the post it shares.
--
-- A share used to be a pointer: its card showed the original post's reactions
-- and comments, and reacting on it reacted to the original. Now a share is its
-- own card with its own engagement, and the original keeps its own.
--
-- Reactions get their own table, because post_reactions is keyed on post_id
-- and a primary key cannot hold a column that is sometimes empty. Comments stay
-- in one table with exactly one of post_id or share_id, so reporting, staff
-- removal and the admin screen already cover comments on shares.

CREATE TABLE share_reactions (
  share_id   RAW(16)                  NOT NULL,
  user_id    RAW(16)                  NOT NULL,
  kind       VARCHAR2(12 CHAR)        NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_share_reactions PRIMARY KEY (share_id, user_id),
  CONSTRAINT fk_share_reactions_share FOREIGN KEY (share_id) REFERENCES post_shares (id) ON DELETE CASCADE,
  CONSTRAINT fk_share_reactions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_share_reactions_kind CHECK (kind IN ('love', 'support', 'like'))
);

CREATE INDEX ix_share_reactions_share ON share_reactions (share_id, kind);

ALTER TABLE post_comments ADD (share_id RAW(16));
ALTER TABLE post_comments MODIFY (post_id NULL);
ALTER TABLE post_comments ADD CONSTRAINT fk_post_comments_share
  FOREIGN KEY (share_id) REFERENCES post_shares (id) ON DELETE CASCADE;
ALTER TABLE post_comments ADD CONSTRAINT ck_post_comments_target CHECK (
  (post_id IS NOT NULL AND share_id IS NULL) OR (post_id IS NULL AND share_id IS NOT NULL)
);

CREATE INDEX ix_post_comments_share ON post_comments (share_id, created_at);

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_type;
ALTER TABLE notifications ADD CONSTRAINT ck_notifications_type CHECK (type IN
  ('application_received', 'application_accepted', 'application_rejected',
   'commission_completed', 'review_received',
   'post_reaction', 'post_comment',
   'payment_submitted', 'payment_confirmed', 'payment_rejected',
   'work_finished', 'commission_shipped', 'problem_reported', 'problem_closed',
   'post_shared', 'balance_method_chosen',
   'account_warning', 'content_removed',
   'share_reaction', 'share_comment'));
