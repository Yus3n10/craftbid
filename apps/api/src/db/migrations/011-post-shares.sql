-- Reposting: sharing someone's portfolio post to your own profile and the feed.
--
-- Scoped to artist_posts, like every other social table, and never to
-- postings: a craft request is the front of a private negotiation, and
-- spreading one around would invite exactly the circling the bid privacy
-- rules exist to stop.
--
-- One share per person per post. A second share of the same post would only
-- repeat it in everyone's feed, so sharing again edits the caption instead.
-- Credit is structural: a share row points at the post, and the post always
-- renders with its own artist, so a share can never present the work as the
-- sharer's.

CREATE TABLE post_shares (
  id         RAW(16)                  NOT NULL,
  post_id    RAW(16)                  NOT NULL,
  user_id    RAW(16)                  NOT NULL,
  caption    VARCHAR2(500 CHAR),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_post_shares PRIMARY KEY (id),
  CONSTRAINT uq_post_shares_user_post UNIQUE (user_id, post_id),
  CONSTRAINT fk_post_shares_post FOREIGN KEY (post_id) REFERENCES artist_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_post_shares_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_post_shares_caption CHECK (caption IS NULL OR LENGTH(TRIM(caption)) > 0)
);

-- The feed interleaves shares with posts by time.
CREATE INDEX ix_post_shares_created ON post_shares (created_at);

-- Share counts on a page of cards.
CREATE INDEX ix_post_shares_post ON post_shares (post_id);

-- A profile's shared posts, and the sharer's own activity history.
CREATE INDEX ix_post_shares_user ON post_shares (user_id, created_at);

-- Activity history reads each person's own reactions and comments by time.
-- The existing indexes on both tables lead with post_id, which answers "who
-- reacted to this post" and cannot answer "what did this person react to".
CREATE INDEX ix_post_reactions_user ON post_reactions (user_id, created_at);

CREATE INDEX ix_post_comments_author ON post_comments (author_id, created_at);

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_type;

ALTER TABLE notifications ADD CONSTRAINT ck_notifications_type CHECK (type IN
  ('application_received', 'application_accepted', 'application_rejected',
   'commission_completed', 'review_received',
   'post_reaction', 'post_comment',
   'payment_submitted', 'payment_confirmed', 'payment_rejected',
   'work_finished', 'commission_shipped', 'problem_reported', 'problem_closed',
   'post_shared'));
