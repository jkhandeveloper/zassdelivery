-- Vendor subscriptions: the monthly platform fee an owner pays to keep their
-- listing live.
--
-- The money does not move through a gateway. The vendor transfers to the
-- platform's own JazzCash, Easypaisa or bank QR and quotes the transaction ID,
-- and an administrator confirms it arrived — the same arrangement as a customer
-- paying a restaurant by QR, and for the same reason: nobody but the payee can
-- say the money landed.
--
-- Deliberately its own pair of tables rather than a reuse of `payments`, whose
-- `order_id` is NOT NULL and whose every read path joins an order. A
-- subscription charge belongs to no order and would have had to invent one.

CREATE TYPE "subscription_status" AS ENUM (
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED'
);

CREATE TYPE "subscription_invoice_status" AS ENUM (
  'OPEN',
  'PENDING_REVIEW',
  'PAID',
  'VOID'
);

-- One row per restaurant, not per owner: an owner with two listings runs two
-- businesses and pays for each, and suspending one must not take the other down.
CREATE TABLE "vendor_subscriptions" (
  "id"                       TEXT                  NOT NULL,
  "restaurant_id"            TEXT                  NOT NULL,
  "owner_id"                 TEXT                  NOT NULL,
  "status"                   "subscription_status" NOT NULL DEFAULT 'TRIALING',
  -- NULL means the platform default, read from the `billing.vendor_monthly_fee`
  -- setting, so a price change reaches every standard-rate vendor without
  -- rewriting a single row here.
  "monthly_fee"              DECIMAL(10,2),
  "currency"                 VARCHAR(3)            NOT NULL DEFAULT 'PKR',
  -- Cycles are a fixed 30 days, so the due date walks through the calendar
  -- rather than landing on the 1st of the month.
  "current_period_start"     TIMESTAMPTZ(3)        NOT NULL,
  "current_period_end"       TIMESTAMPTZ(3)        NOT NULL,
  "trial_ends_at"            TIMESTAMPTZ(3),
  "last_paid_at"             TIMESTAMPTZ(3),
  "suspended_at"             TIMESTAMPTZ(3),
  -- Records that *billing* took the listing down, and what it was before. An
  -- administrator who suspended a restaurant for its own reasons must not have
  -- that decision quietly undone by a later payment.
  "suspended_by_billing"     BOOLEAN               NOT NULL DEFAULT false,
  "status_before_suspension" "restaurant_status",
  "created_at"               TIMESTAMPTZ(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMPTZ(3)        NOT NULL,

  CONSTRAINT "vendor_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_subscriptions_restaurant_id_key"
  ON "vendor_subscriptions" ("restaurant_id");

CREATE INDEX "vendor_subscriptions_status_current_period_end_idx"
  ON "vendor_subscriptions" ("status", "current_period_end");

CREATE INDEX "vendor_subscriptions_owner_id_idx"
  ON "vendor_subscriptions" ("owner_id");

-- One month's charge and the paper trail for how it was settled.
CREATE TABLE "subscription_invoices" (
  "id"                TEXT                          NOT NULL,
  "subscription_id"   TEXT                          NOT NULL,
  -- Denormalised so the admin queue can filter by listing without a join.
  "restaurant_id"     TEXT                          NOT NULL,
  "invoice_number"    VARCHAR(40)                   NOT NULL,
  "status"            "subscription_invoice_status" NOT NULL DEFAULT 'OPEN',
  "amount"            DECIMAL(10,2)                 NOT NULL,
  "currency"          VARCHAR(3)                    NOT NULL DEFAULT 'PKR',
  -- `due_at` equals `period_start`: the fee is paid up front, which is why the
  -- first month being free is what gets a vendor trading before they are asked
  -- for anything.
  "period_start"      TIMESTAMPTZ(3)                NOT NULL,
  "period_end"        TIMESTAMPTZ(3)                NOT NULL,
  "due_at"            TIMESTAMPTZ(3)                NOT NULL,
  -- When an unpaid invoice takes the listing down: `due_at` plus the grace days.
  "block_at"          TIMESTAMPTZ(3)                NOT NULL,
  -- The free first month, recorded rather than skipped so a vendor's billing
  -- history reads continuously from the day they went live.
  "is_trial"          BOOLEAN                       NOT NULL DEFAULT false,

  -- What the vendor says.
  "submitted_at"      TIMESTAMPTZ(3),
  "submitted_by_id"   TEXT,
  "channel"           VARCHAR(20),
  "reference"         VARCHAR(120),
  "proof_image_url"   VARCHAR(500),

  -- What an administrator decided.
  "paid_at"           TIMESTAMPTZ(3),
  "confirmed_by_id"   TEXT,
  "rejected_at"       TIMESTAMPTZ(3),
  "rejection_reason"  VARCHAR(500),
  "void_reason"       VARCHAR(500),

  -- The smallest lead-time reminder already sent, in days before `due_at`. The
  -- sweep runs daily and must not send the same warning twice; one integer is
  -- cheaper than a table of sent messages.
  "last_reminder_day" INTEGER,

  "created_at"        TIMESTAMPTZ(3)                NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ(3)                NOT NULL,

  CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_invoices_invoice_number_key"
  ON "subscription_invoices" ("invoice_number");

-- A transfer's TID is proof of one payment. Accepting it twice is how one
-- screenshot settles two months.
CREATE UNIQUE INDEX "subscription_invoices_reference_key"
  ON "subscription_invoices" ("reference");

CREATE INDEX "subscription_invoices_subscription_id_created_at_idx"
  ON "subscription_invoices" ("subscription_id", "created_at");

CREATE INDEX "subscription_invoices_restaurant_id_status_idx"
  ON "subscription_invoices" ("restaurant_id", "status");

-- The sweep's two working queries: what to remind about, and what to take down.
CREATE INDEX "subscription_invoices_status_due_at_idx"
  ON "subscription_invoices" ("status", "due_at");

CREATE INDEX "subscription_invoices_status_block_at_idx"
  ON "subscription_invoices" ("status", "block_at");

ALTER TABLE "vendor_subscriptions"
  ADD CONSTRAINT "vendor_subscriptions_restaurant_id_fkey"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_subscriptions"
  ADD CONSTRAINT "vendor_subscriptions_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_invoices"
  ADD CONSTRAINT "subscription_invoices_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "vendor_subscriptions" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_invoices"
  ADD CONSTRAINT "subscription_invoices_restaurant_id_fkey"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The staff who acted keep their name on the record, but a deleted account must
-- not take the invoice with it.
ALTER TABLE "subscription_invoices"
  ADD CONSTRAINT "subscription_invoices_submitted_by_id_fkey"
  FOREIGN KEY ("submitted_by_id") REFERENCES "users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "subscription_invoices"
  ADD CONSTRAINT "subscription_invoices_confirmed_by_id_fkey"
  FOREIGN KEY ("confirmed_by_id") REFERENCES "users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Human-readable invoice references (SUB-260912-0001).
--
-- A sequence rather than COUNT(*)+1, for the same reason order numbers and
-- payment references use one: two invoices issued in the same millisecond would
-- otherwise compute the same number, and the unique index would reject one of
-- them at random — during the nightly sweep, which is exactly when every
-- invoice on the platform is issued at once.
CREATE SEQUENCE IF NOT EXISTS "subscription_invoice_seq" START 1;

-- Restaurants that were already live when billing arrived are not backfilled
-- here. The nightly sweep opens a subscription for any ACTIVE listing that
-- lacks one, so the trial-start logic lives in one place rather than being
-- half-expressed in SQL that can never be re-run.
