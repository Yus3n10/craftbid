-- Identity, profiles, images and sessions.
--
-- Shared profile fields (display name, bio, avatar, cover, location) live on
-- USERS because a client needs every one of them too. Only artist-specific
-- data gets a side table; a CLIENT_PROFILES table would hold nothing.
--
-- Two Oracle portability rules apply throughout the schema:
--   * Flags are NUMBER(1) constrained to 0/1, not BOOLEAN, which is 23ai-only.
--     The production Autonomous Database version is not known yet and Always
--     Free ADB can be provisioned as 19c.
--   * VARCHAR2 lengths are declared in CHAR, not the default BYTE. A Filipino
--     name with an enye, or any emoji, costs multiple bytes; byte semantics
--     would truncate real user input. Oracle caps a CHAR-semantics column at
--     4000 bytes, so 1000 CHAR is the practical maximum and anything longer
--     is a CLOB.

CREATE TABLE users (
  id               RAW(16)                  NOT NULL,
  email            VARCHAR2(255 CHAR)       NOT NULL,
  username         VARCHAR2(30 CHAR)        NOT NULL,
  password_hash    VARCHAR2(255 CHAR)       NOT NULL,
  role             VARCHAR2(10 CHAR)        NOT NULL,
  display_name     VARCHAR2(80 CHAR)        NOT NULL,
  bio              VARCHAR2(1000 CHAR),
  region           VARCHAR2(80 CHAR),
  city             VARCHAR2(80 CHAR),
  avatar_image_id  RAW(16),
  cover_image_id   RAW(16),
  status           VARCHAR2(20 CHAR)        DEFAULT 'active' NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_users PRIMARY KEY (id),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT ck_users_role CHECK (role IN ('client', 'artist')),
  CONSTRAINT ck_users_status CHECK (status IN ('active', 'suspended', 'deleted')),
  -- Stored lowercase so uniqueness is genuinely case-insensitive. Without this
  -- "Maria" and "maria" would be two separate accounts.
  CONSTRAINT ck_users_email_lower CHECK (email = LOWER(email)),
  CONSTRAINT ck_users_username_lower CHECK (username = LOWER(username))
);

-- Every uploaded image, owned by its uploader. One table rather than repeating
-- key/size/dimensions across postings, posts and avatars, which also makes an
-- orphan sweep a single query.
CREATE TABLE images (
  id           RAW(16)                  NOT NULL,
  owner_id     RAW(16)                  NOT NULL,
  object_key   VARCHAR2(500 CHAR)       NOT NULL,
  content_type VARCHAR2(50 CHAR)        NOT NULL,
  byte_size    NUMBER(10)               NOT NULL,
  width        NUMBER(6)                NOT NULL,
  height       NUMBER(6)                NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_images PRIMARY KEY (id),
  CONSTRAINT uq_images_object_key UNIQUE (object_key),
  CONSTRAINT fk_images_owner FOREIGN KEY (owner_id) REFERENCES users (id),
  CONSTRAINT ck_images_dimensions CHECK (width > 0 AND height > 0),
  CONSTRAINT ck_images_size CHECK (byte_size > 0),
  CONSTRAINT ck_images_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp'))
);

-- Added after IMAGES exists because the reference is mutual: a user points at
-- an avatar, and every image points back at its owner.
ALTER TABLE users ADD CONSTRAINT fk_users_avatar
  FOREIGN KEY (avatar_image_id) REFERENCES images (id) ON DELETE SET NULL;

ALTER TABLE users ADD CONSTRAINT fk_users_cover
  FOREIGN KEY (cover_image_id) REFERENCES images (id) ON DELETE SET NULL;

CREATE INDEX ix_images_owner ON images (owner_id);
CREATE INDEX ix_users_role_status ON users (role, status);

CREATE TABLE artist_profiles (
  user_id               RAW(16)                  NOT NULL,
  headline              VARCHAR2(120 CHAR),
  accepting_commissions NUMBER(1)                DEFAULT 1 NOT NULL,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_artist_profiles PRIMARY KEY (user_id),
  CONSTRAINT fk_artist_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_artist_accepting CHECK (accepting_commissions IN (0, 1))
);

CREATE TABLE craft_categories (
  id          NUMBER(4)           NOT NULL,
  slug        VARCHAR2(50 CHAR)   NOT NULL,
  name        VARCHAR2(80 CHAR)   NOT NULL,
  description VARCHAR2(300 CHAR),
  sort_order  NUMBER(4)           DEFAULT 0 NOT NULL,
  is_active   NUMBER(1)           DEFAULT 1 NOT NULL,
  CONSTRAINT pk_craft_categories PRIMARY KEY (id),
  CONSTRAINT uq_craft_categories_slug UNIQUE (slug),
  CONSTRAINT ck_craft_categories_active CHECK (is_active IN (0, 1))
);

-- Which of the seeded categories an artist works in.
CREATE TABLE artist_categories (
  artist_id   RAW(16)   NOT NULL,
  category_id NUMBER(4) NOT NULL,
  CONSTRAINT pk_artist_categories PRIMARY KEY (artist_id, category_id),
  CONSTRAINT fk_artist_categories_artist FOREIGN KEY (artist_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_artist_categories_category FOREIGN KEY (category_id) REFERENCES craft_categories (id)
);

CREATE INDEX ix_artist_categories_category ON artist_categories (category_id);

-- Free-text specialities such as "amigurumi" or "tunisian crochet", finer
-- grained than the fixed category list and impossible to enumerate up front.
CREATE TABLE artist_skills (
  artist_id RAW(16)           NOT NULL,
  skill     VARCHAR2(40 CHAR) NOT NULL,
  CONSTRAINT pk_artist_skills PRIMARY KEY (artist_id, skill),
  CONSTRAINT fk_artist_skills_artist FOREIGN KEY (artist_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_artist_skills_lower CHECK (skill = LOWER(skill))
);

CREATE TABLE external_links (
  id         RAW(16)                  NOT NULL,
  user_id    RAW(16)                  NOT NULL,
  platform   VARCHAR2(30 CHAR)        NOT NULL,
  url        VARCHAR2(500 CHAR)       NOT NULL,
  label      VARCHAR2(60 CHAR),
  sort_order NUMBER(3)                DEFAULT 0 NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_external_links PRIMARY KEY (id),
  CONSTRAINT fk_external_links_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_external_links_platform CHECK (platform IN
    ('facebook', 'instagram', 'tiktok', 'x', 'youtube', 'pinterest', 'shopee', 'lazada', 'website', 'other')),
  -- The application validates this too. Enforcing it here as well means a
  -- javascript: or data: URL cannot reach the database through any code path.
  CONSTRAINT ck_external_links_https CHECK (LOWER(url) LIKE 'https://%')
);

CREATE INDEX ix_external_links_user ON external_links (user_id);

-- Only the SHA-256 of a refresh token is stored, so a database leak does not
-- hand over usable sessions. Tokens rotate on every refresh.
CREATE TABLE refresh_tokens (
  id         RAW(16)                  NOT NULL,
  user_id    RAW(16)                  NOT NULL,
  token_hash VARCHAR2(64 CHAR)        NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_refresh_tokens PRIMARY KEY (id),
  CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_refresh_tokens_user ON refresh_tokens (user_id);
