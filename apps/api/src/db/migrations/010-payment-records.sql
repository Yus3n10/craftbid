-- Payment records: a down payment to start the work and the balance before the
-- piece is handed over, paid directly between client and artist.
--
-- Craftbid never receives this money. These tables record what the two sides
-- say happened, and the rules that make that record worth trusting live here,
-- in constraints, so no future code path can forget them.
--
-- Existing commissions are left untracked (payment_tracking = 0) and keep the
-- flow they were started under. Only commissions created after this migration
-- carry the amounts and the stages below.

ALTER TABLE commissions ADD (
  payment_tracking      NUMBER(1)                DEFAULT 0 NOT NULL,
  -- Copied at creation, like the bid minimum is copied onto the bid, so a
  -- later change to the down payment rule cannot rewrite an agreed deal.
  down_payment_centavos NUMBER(12),
  balance_centavos      NUMBER(12),
  balance_method        VARCHAR2(10 CHAR),
  finished_at           TIMESTAMP WITH TIME ZONE,
  shipping_courier      VARCHAR2(60 CHAR),
  shipping_tracking     VARCHAR2(60 CHAR),
  shipped_at            TIMESTAMP WITH TIME ZONE,
  CONSTRAINT ck_commissions_tracking CHECK (payment_tracking IN (0, 1)),
  CONSTRAINT ck_commissions_split CHECK (
    (payment_tracking = 0
       AND down_payment_centavos IS NULL AND balance_centavos IS NULL AND balance_method IS NULL)
    OR
    (payment_tracking = 1
       AND down_payment_centavos > 0 AND balance_centavos >= 0
       AND down_payment_centavos + balance_centavos = agreed_price_centavos
       AND balance_method IN ('transfer', 'cod', 'meetup'))
  )
);

-- Where an artist is paid. One row per method.
CREATE TABLE payout_accounts (
  user_id        RAW(16)                  NOT NULL,
  method         VARCHAR2(10 CHAR)        NOT NULL,
  account_name   VARCHAR2(80 CHAR)        NOT NULL,
  account_number VARCHAR2(40 CHAR)        NOT NULL,
  bank_name      VARCHAR2(80 CHAR),
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_payout_accounts PRIMARY KEY (user_id, method),
  CONSTRAINT fk_payout_accounts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_payout_accounts_method CHECK (method IN ('gcash', 'maya', 'bank')),
  CONSTRAINT ck_payout_accounts_bank CHECK (
    (method = 'bank' AND bank_name IS NOT NULL) OR (method <> 'bank' AND bank_name IS NULL)
  )
);

-- Receipts and photos of the finished piece. Stored as private objects and
-- only ever served through the API to the two parties, never by URL.
CREATE TABLE commission_files (
  id            RAW(16)                  NOT NULL,
  commission_id RAW(16)                  NOT NULL,
  uploader_id   RAW(16)                  NOT NULL,
  kind          VARCHAR2(20 CHAR)        NOT NULL,
  object_key    VARCHAR2(300 CHAR)       NOT NULL,
  content_type  VARCHAR2(50 CHAR)        NOT NULL,
  byte_size     NUMBER(10)               NOT NULL,
  width         NUMBER(5)                NOT NULL,
  height        NUMBER(5)                NOT NULL,
  -- Of the bytes as uploaded: the same file uploaded twice matches exactly.
  -- There is deliberately no perceptual hash. Measured on receipt-like
  -- screenshots, a re-saved copy of one receipt differed by more bits than two
  -- genuinely different receipts from the same app, so a "looks similar"
  -- check would either miss re-saves or accuse honest receipts. The reference
  -- number is what catches a recycled receipt, and the artist's confirmation
  -- is what proves a payment.
  sha256        VARCHAR2(64 CHAR)        NOT NULL,
  attached_at   TIMESTAMP WITH TIME ZONE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_commission_files PRIMARY KEY (id),
  CONSTRAINT fk_commission_files_commission FOREIGN KEY (commission_id) REFERENCES commissions (id),
  CONSTRAINT fk_commission_files_uploader FOREIGN KEY (uploader_id) REFERENCES users (id),
  CONSTRAINT ck_commission_files_kind CHECK (kind IN ('receipt', 'finished_photo')),
  CONSTRAINT uq_commission_files_key UNIQUE (object_key)
);

CREATE INDEX ix_commission_files_commission ON commission_files (commission_id, kind);

CREATE TABLE commission_payments (
  id               RAW(16)                  NOT NULL,
  commission_id    RAW(16)                  NOT NULL,
  kind             VARCHAR2(10 CHAR)        NOT NULL,
  method           VARCHAR2(10 CHAR)        NOT NULL,
  status           VARCHAR2(10 CHAR)        DEFAULT 'submitted' NOT NULL,
  amount_centavos  NUMBER(12)               NOT NULL,
  reference_number VARCHAR2(40 CHAR),
  paid_on          DATE,
  receipt_file_id  RAW(16),
  receipt_sha256   VARCHAR2(64 CHAR),
  -- The account the client paid, copied when recorded.
  paid_to_name     VARCHAR2(80 CHAR),
  paid_to_number   VARCHAR2(40 CHAR),
  paid_to_bank     VARCHAR2(80 CHAR),
  recorded_by      RAW(16)                  NOT NULL,
  submitted_at     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  decided_at       TIMESTAMP WITH TIME ZONE,
  CONSTRAINT pk_commission_payments PRIMARY KEY (id),
  CONSTRAINT fk_commission_payments_commission FOREIGN KEY (commission_id) REFERENCES commissions (id),
  CONSTRAINT fk_commission_payments_receipt FOREIGN KEY (receipt_file_id) REFERENCES commission_files (id),
  CONSTRAINT fk_commission_payments_recorder FOREIGN KEY (recorded_by) REFERENCES users (id),
  CONSTRAINT ck_commission_payments_kind CHECK (kind IN ('down', 'balance')),
  CONSTRAINT ck_commission_payments_method CHECK (method IN ('gcash', 'maya', 'bank', 'cod', 'cash')),
  CONSTRAINT ck_commission_payments_status CHECK (status IN ('submitted', 'confirmed', 'rejected')),
  CONSTRAINT ck_commission_payments_amount CHECK (amount_centavos > 0),
  -- A transfer carries its proof. Cash and COD are only ever the balance, and
  -- only ever recorded as already received, by the person who received them.
  CONSTRAINT ck_commission_payments_shape CHECK (
    (method IN ('gcash', 'maya', 'bank')
       AND reference_number IS NOT NULL AND paid_on IS NOT NULL
       AND receipt_file_id IS NOT NULL AND receipt_sha256 IS NOT NULL
       AND paid_to_name IS NOT NULL AND paid_to_number IS NOT NULL)
    OR
    (method IN ('cod', 'cash')
       AND kind = 'balance' AND status = 'confirmed'
       AND reference_number IS NULL AND receipt_file_id IS NULL)
  ),
  CONSTRAINT ck_commission_payments_decided CHECK (
    (status = 'submitted' AND decided_at IS NULL) OR (status <> 'submitted' AND decided_at IS NOT NULL)
  )
);

CREATE INDEX ix_commission_payments_commission ON commission_payments (commission_id, submitted_at);

-- One live payment of each kind per commission. A rejected one does not count,
-- so the client can submit again after a mistake.
CREATE UNIQUE INDEX ux_commission_payments_live ON commission_payments (
  CASE WHEN status <> 'rejected' THEN commission_id END,
  CASE WHEN status <> 'rejected' THEN kind END
);

-- A reference number backs at most one live payment anywhere on Craftbid, which
-- stops one real transfer being presented for two commissions.
CREATE UNIQUE INDEX ux_commission_payments_reference ON commission_payments (
  CASE WHEN status <> 'rejected' AND reference_number IS NOT NULL THEN method END,
  CASE WHEN status <> 'rejected' AND reference_number IS NOT NULL THEN reference_number END
);

-- The same receipt file, byte for byte, backs at most one live payment.
CREATE UNIQUE INDEX ux_commission_payments_receipt ON commission_payments (
  CASE WHEN status <> 'rejected' THEN receipt_sha256 END
);

CREATE TABLE commission_problems (
  id            RAW(16)                  NOT NULL,
  commission_id RAW(16)                  NOT NULL,
  opened_by     RAW(16)                  NOT NULL,
  reason        VARCHAR2(30 CHAR)        NOT NULL,
  details       VARCHAR2(2000 CHAR)      NOT NULL,
  status        VARCHAR2(10 CHAR)        DEFAULT 'open' NOT NULL,
  resolution    VARCHAR2(1000 CHAR),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  closed_at     TIMESTAMP WITH TIME ZONE,
  CONSTRAINT pk_commission_problems PRIMARY KEY (id),
  CONSTRAINT fk_commission_problems_commission FOREIGN KEY (commission_id) REFERENCES commissions (id),
  CONSTRAINT fk_commission_problems_opener FOREIGN KEY (opened_by) REFERENCES users (id),
  CONSTRAINT ck_commission_problems_reason CHECK (reason IN
    ('payment_not_received', 'work_not_delivered', 'not_as_agreed', 'stopped_responding', 'other')),
  CONSTRAINT ck_commission_problems_status CHECK (status IN ('open', 'withdrawn', 'resolved')),
  CONSTRAINT ck_commission_problems_closed CHECK (
    (status = 'open' AND closed_at IS NULL) OR (status <> 'open' AND closed_at IS NOT NULL)
  )
);

-- One open problem per commission; while it is open the commission is paused.
CREATE UNIQUE INDEX ux_commission_problems_open ON commission_problems (
  CASE WHEN status = 'open' THEN commission_id END
);

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_type;

ALTER TABLE notifications ADD CONSTRAINT ck_notifications_type CHECK (type IN
  ('application_received', 'application_accepted', 'application_rejected',
   'commission_completed', 'review_received',
   'post_reaction', 'post_comment',
   'payment_submitted', 'payment_confirmed', 'payment_rejected',
   'work_finished', 'commission_shipped', 'problem_reported', 'problem_closed'));
