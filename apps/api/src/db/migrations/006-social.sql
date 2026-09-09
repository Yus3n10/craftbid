-- The social layer: reactions, comments and saves on artist posts.
--
-- Scoped to artist_posts on purpose, and never to postings. A craft request is
-- the front of a private negotiation: if people could comment publicly on one,
-- artists would read each other's interest and price against it, which is the
-- same harm the bid privacy rules already prevent. Portfolio work is the part
-- of this product that is genuinely public, so that is where the feed lives.

CREATE TABLE post_reactions (
  post_id    RAW(16)                  NOT NULL,
  user_id    RAW(16)                  NOT NULL,
  kind       VARCHAR2(12 CHAR)        NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  -- One reaction per person per post: reacting again replaces the old one
  -- rather than stacking, so a count is a count of people, not of clicks.
  CONSTRAINT pk_post_reactions PRIMARY KEY (post_id, user_id),
  CONSTRAINT fk_post_reactions_post FOREIGN KEY (post_id) REFERENCES artist_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_post_reactions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_post_reactions_kind CHECK (kind IN ('love', 'support', 'like'))
);

-- Counting a post's reactions by kind is the query every card in the feed
-- runs, so it is the one the index is shaped for.
CREATE INDEX ix_post_reactions_post ON post_reactions (post_id, kind);

CREATE TABLE post_comments (
  id         RAW(16)                  NOT NULL,
  post_id    RAW(16)                  NOT NULL,
  author_id  RAW(16)                  NOT NULL,
  body       VARCHAR2(1000 CHAR)      NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_post_comments PRIMARY KEY (id),
  CONSTRAINT fk_post_comments_post FOREIGN KEY (post_id) REFERENCES artist_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_post_comments_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_post_comments_body CHECK (LENGTH(TRIM(body)) > 0)
);

-- A post's comments, oldest first, which is how a thread reads.
CREATE INDEX ix_post_comments_post ON post_comments (post_id, created_at);

CREATE TABLE saved_posts (
  user_id    RAW(16)                  NOT NULL,
  post_id    RAW(16)                  NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_saved_posts PRIMARY KEY (user_id, post_id),
  CONSTRAINT fk_saved_posts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_saved_posts_post FOREIGN KEY (post_id) REFERENCES artist_posts (id) ON DELETE CASCADE
);

-- "My saved posts, most recently saved first."
CREATE INDEX ix_saved_posts_user ON saved_posts (user_id, created_at DESC);
