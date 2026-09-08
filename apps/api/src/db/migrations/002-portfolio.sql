-- Artist portfolio and showcase posts.
--
-- The brief listed PORTFOLIO_ITEMS and ARTIST_POSTS as separate candidates.
-- They are one entity here: the same record read two ways. On a profile it is
-- a portfolio piece, in discovery it is a feed post, and on an application it
-- is a work sample. Splitting them would mean two tables, two upload paths and
-- two ways for an artist's best work to be in the wrong one.

CREATE TABLE artist_posts (
  id          RAW(16)                  NOT NULL,
  artist_id   RAW(16)                  NOT NULL,
  caption     VARCHAR2(1000 CHAR)      NOT NULL,
  description CLOB,
  category_id NUMBER(4),
  status      VARCHAR2(20 CHAR)        DEFAULT 'published' NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_artist_posts PRIMARY KEY (id),
  CONSTRAINT fk_artist_posts_artist FOREIGN KEY (artist_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_artist_posts_category FOREIGN KEY (category_id) REFERENCES craft_categories (id),
  CONSTRAINT ck_artist_posts_status CHECK (status IN ('published', 'hidden', 'removed'))
);

-- Ordering by newest is the default view on both a profile and the feed.
CREATE INDEX ix_artist_posts_artist ON artist_posts (artist_id, created_at DESC);
CREATE INDEX ix_artist_posts_feed ON artist_posts (status, created_at DESC);
CREATE INDEX ix_artist_posts_category ON artist_posts (category_id, created_at DESC);

CREATE TABLE artist_post_images (
  post_id    RAW(16)   NOT NULL,
  image_id   RAW(16)   NOT NULL,
  sort_order NUMBER(3) DEFAULT 0 NOT NULL,
  CONSTRAINT pk_artist_post_images PRIMARY KEY (post_id, image_id),
  CONSTRAINT fk_artist_post_images_post FOREIGN KEY (post_id) REFERENCES artist_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_artist_post_images_image FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE,
  -- An image belongs to one post; reusing it across posts would make deleting
  -- either one ambiguous.
  CONSTRAINT uq_artist_post_images_image UNIQUE (image_id)
);

CREATE INDEX ix_artist_post_images_order ON artist_post_images (post_id, sort_order);
