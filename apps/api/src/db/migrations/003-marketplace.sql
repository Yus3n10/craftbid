-- The marketplace core: postings, applications, commissions and reviews.
--
-- Money is an integer number of centavos in NUMBER(12). No column anywhere in
-- this schema stores a fractional peso, because binary floating point cannot
-- represent 0.10 exactly and rounding drift on prices is not acceptable.

CREATE TABLE postings (
  id                  RAW(16)                  NOT NULL,
  client_id           RAW(16)                  NOT NULL,
  title               VARCHAR2(140 CHAR)       NOT NULL,
  description         CLOB                     NOT NULL,
  category_id         NUMBER(4)                NOT NULL,
  min_budget_centavos NUMBER(12)               NOT NULL,
  requirements        CLOB,
  deadline            DATE,
  status              VARCHAR2(20 CHAR)        DEFAULT 'open' NOT NULL,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_postings PRIMARY KEY (id),
  CONSTRAINT fk_postings_client FOREIGN KEY (client_id) REFERENCES users (id),
  CONSTRAINT fk_postings_category FOREIGN KEY (category_id) REFERENCES craft_categories (id),
  CONSTRAINT ck_postings_status CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT ck_postings_budget CHECK (min_budget_centavos > 0)
);

-- Browsing is almost always "open postings, newest first, maybe filtered by
-- category", so that is the index.
CREATE INDEX ix_postings_browse ON postings (status, category_id, created_at DESC);
CREATE INDEX ix_postings_client ON postings (client_id, created_at DESC);

CREATE TABLE posting_images (
  posting_id RAW(16)   NOT NULL,
  image_id   RAW(16)   NOT NULL,
  sort_order NUMBER(3) DEFAULT 0 NOT NULL,
  CONSTRAINT pk_posting_images PRIMARY KEY (posting_id, image_id),
  CONSTRAINT fk_posting_images_posting FOREIGN KEY (posting_id) REFERENCES postings (id) ON DELETE CASCADE,
  CONSTRAINT fk_posting_images_image FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE,
  CONSTRAINT uq_posting_images_image UNIQUE (image_id)
);

CREATE INDEX ix_posting_images_order ON posting_images (posting_id, sort_order);

CREATE TABLE applications (
  id                          RAW(16)                  NOT NULL,
  posting_id                  RAW(16)                  NOT NULL,
  artist_id                   RAW(16)                  NOT NULL,
  proposed_price_centavos     NUMBER(12)               NOT NULL,
  -- The posting's minimum, copied at the moment of applying.
  --
  -- This is what turns "a bid may not undercut the posted minimum" from a
  -- cross-row rule needing a trigger into the plain CHECK below. It is also
  -- the more honest model: it records the minimum the artist actually saw and
  -- agreed to, so a later edit by the client cannot retroactively invalidate
  -- a bid that was legitimate when it was made.
  min_price_at_apply_centavos NUMBER(12)               NOT NULL,
  cover_letter                CLOB                     NOT NULL,
  status                      VARCHAR2(20 CHAR)        DEFAULT 'pending' NOT NULL,
  created_at                  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_applications PRIMARY KEY (id),
  CONSTRAINT fk_applications_posting FOREIGN KEY (posting_id) REFERENCES postings (id) ON DELETE CASCADE,
  CONSTRAINT fk_applications_artist FOREIGN KEY (artist_id) REFERENCES users (id),
  -- An artist gets one application per posting. Enforced here rather than by a
  -- read-then-insert in the service, which would race under concurrency.
  CONSTRAINT uq_applications_posting_artist UNIQUE (posting_id, artist_id),
  CONSTRAINT ck_applications_status CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  CONSTRAINT ck_applications_price_positive CHECK (proposed_price_centavos > 0),
  -- The rule the marketplace depends on: never bid below the minimum.
  CONSTRAINT ck_applications_meets_minimum
    CHECK (proposed_price_centavos >= min_price_at_apply_centavos)
);

-- At most one accepted application per posting.
--
-- Oracle does not index an entry whose key is entirely NULL, so every pending,
-- rejected and withdrawn row evaluates to NULL and is simply absent from this
-- index. Only accepted rows occupy it, and a second one for the same posting
-- fails with ORA-00001. This makes "the client selected two artists" a state
-- the database will not hold, rather than one the service must remember to
-- prevent.
CREATE UNIQUE INDEX ux_applications_one_accepted
  ON applications (CASE WHEN status = 'accepted' THEN posting_id END);

CREATE INDEX ix_applications_artist ON applications (artist_id, created_at DESC);
CREATE INDEX ix_applications_posting ON applications (posting_id, status);

-- Portfolio pieces an artist attached to an application as relevant samples.
CREATE TABLE application_samples (
  application_id RAW(16) NOT NULL,
  post_id        RAW(16) NOT NULL,
  CONSTRAINT pk_application_samples PRIMARY KEY (application_id, post_id),
  CONSTRAINT fk_application_samples_application FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE,
  CONSTRAINT fk_application_samples_post FOREIGN KEY (post_id) REFERENCES artist_posts (id) ON DELETE CASCADE
);

-- The agreed engagement between one client and one artist.
--
-- This is the seam payments would attach to later: AGREED_PRICE_CENTAVOS is
-- already the authoritative amount, so adding an escrow or payout table later
-- does not require reshaping the marketplace around it.
CREATE TABLE commissions (
  id                    RAW(16)                  NOT NULL,
  posting_id            RAW(16)                  NOT NULL,
  application_id        RAW(16)                  NOT NULL,
  -- Denormalised from posting and application. Every authorization check on a
  -- commission asks "is the caller one of these two people", and making that a
  -- two-table join on every request buys nothing.
  client_id             RAW(16)                  NOT NULL,
  artist_id             RAW(16)                  NOT NULL,
  agreed_price_centavos NUMBER(12)               NOT NULL,
  status                VARCHAR2(20 CHAR)        DEFAULT 'active' NOT NULL,
  started_at            TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  completed_at          TIMESTAMP WITH TIME ZONE,
  cancelled_at          TIMESTAMP WITH TIME ZONE,
  CONSTRAINT pk_commissions PRIMARY KEY (id),
  -- One commission per posting, and a given application can only ever produce
  -- one commission.
  CONSTRAINT uq_commissions_posting UNIQUE (posting_id),
  CONSTRAINT uq_commissions_application UNIQUE (application_id),
  CONSTRAINT fk_commissions_posting FOREIGN KEY (posting_id) REFERENCES postings (id),
  CONSTRAINT fk_commissions_application FOREIGN KEY (application_id) REFERENCES applications (id),
  CONSTRAINT fk_commissions_client FOREIGN KEY (client_id) REFERENCES users (id),
  CONSTRAINT fk_commissions_artist FOREIGN KEY (artist_id) REFERENCES users (id),
  CONSTRAINT ck_commissions_status CHECK (status IN ('active', 'completed', 'cancelled')),
  CONSTRAINT ck_commissions_price CHECK (agreed_price_centavos > 0),
  CONSTRAINT ck_commissions_distinct_parties CHECK (client_id <> artist_id),
  -- A completed commission must say when, and only a completed one may.
  CONSTRAINT ck_commissions_completed_at CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    (status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE INDEX ix_commissions_client ON commissions (client_id, started_at DESC);
CREATE INDEX ix_commissions_artist ON commissions (artist_id, started_at DESC);

-- Reviews are write-once by design. There is no updated_at, and the API
-- exposes no edit or delete route: a reputation record that the reviewed party
-- can get rewritten is not a reputation record.
CREATE TABLE reviews (
  id            RAW(16)                  NOT NULL,
  commission_id RAW(16)                  NOT NULL,
  reviewer_id   RAW(16)                  NOT NULL,
  reviewee_id   RAW(16)                  NOT NULL,
  rating        NUMBER(1)                NOT NULL,
  body          CLOB,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_reviews PRIMARY KEY (id),
  -- One review per person per commission. Stops the same commission being
  -- farmed for repeated ratings.
  CONSTRAINT uq_reviews_commission_reviewer UNIQUE (commission_id, reviewer_id),
  CONSTRAINT fk_reviews_commission FOREIGN KEY (commission_id) REFERENCES commissions (id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES users (id),
  CONSTRAINT fk_reviews_reviewee FOREIGN KEY (reviewee_id) REFERENCES users (id),
  CONSTRAINT ck_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT ck_reviews_not_self CHECK (reviewer_id <> reviewee_id)
);

-- Profile pages aggregate every review written about a user.
CREATE INDEX ix_reviews_reviewee ON reviews (reviewee_id, created_at DESC);
