-- How much each person has shown interest in each craft.
--
-- Read only to order that person's own home feed. No endpoint returns these
-- rows. Saves, shares, comments, bids, requests, reactions, searches that name a
-- craft and browsing a craft each add a weight to the craft they concern.
--
-- The score decays with a 30-day half-life, applied whenever it is read or
-- bumped, so a craft someone has moved on from fades without a job to clear it.

CREATE TABLE user_category_interest (
  user_id     RAW(16)                  NOT NULL,
  category_id NUMBER(4)                NOT NULL,
  score       NUMBER(10, 4)            NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_user_category_interest PRIMARY KEY (user_id, category_id),
  CONSTRAINT fk_user_category_interest_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_category_interest_cat FOREIGN KEY (category_id) REFERENCES craft_categories (id),
  CONSTRAINT ck_user_category_interest_score CHECK (score >= 0)
);
