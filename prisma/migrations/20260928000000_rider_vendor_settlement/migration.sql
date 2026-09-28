-- Riders are paid by the restaurant, not by the platform.
--
-- The rider keeps the customer's delivery fee and tip. On a cash order (or one
-- paid to the rider's own QR) they hand the restaurant the rest; on an order
-- the restaurant was paid for directly, the restaurant owes them the fee. The
-- platform never holds that money, so the rider wallet top-up and the
-- withdrawal queue go away. Earnings rows stay as the rider's record of what
-- they made.

CREATE TYPE "rider_settlement_direction" AS ENUM ('RIDER_TO_RESTAURANT', 'RESTAURANT_TO_RIDER');

ALTER TYPE "driver_earning_type" ADD VALUE IF NOT EXISTS 'DELIVERY_FEE';

-- Withdrawals: the platform no longer pays riders out.
DROP TABLE "payout_requests";
DROP TYPE "payout_method";
DROP TYPE "payout_status";
DROP SEQUENCE IF EXISTS "payout_reference_seq";
DELETE FROM "permissions" WHERE "code" IN ('payouts.read', 'payouts.approve');

-- The fare knobs only priced the platform-paid fare, which no longer exists.
DELETE FROM "settings" WHERE "key" IN (
  'earnings.base_fare',
  'earnings.per_km_rate',
  'earnings.minimum_fare',
  'earnings.tip_share_percentage',
  'payouts.min_withdrawal_amount'
);

CREATE TABLE "rider_ledger_entries" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "collected_amount" DECIMAL(10,2) NOT NULL,
    "rider_fee" DECIMAL(10,2) NOT NULL,
    "net_amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rider_settlements" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "direction" "rider_settlement_direction" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "note" VARCHAR(300),
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_settlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rider_ledger_entries_order_id_key" ON "rider_ledger_entries"("order_id");
CREATE INDEX "rider_ledger_entries_driver_id_restaurant_id_created_at_idx" ON "rider_ledger_entries"("driver_id", "restaurant_id", "created_at");
CREATE INDEX "rider_ledger_entries_restaurant_id_created_at_idx" ON "rider_ledger_entries"("restaurant_id", "created_at");
CREATE INDEX "rider_settlements_driver_id_restaurant_id_created_at_idx" ON "rider_settlements"("driver_id", "restaurant_id", "created_at");
CREATE INDEX "rider_settlements_restaurant_id_created_at_idx" ON "rider_settlements"("restaurant_id", "created_at");

ALTER TABLE "rider_ledger_entries" ADD CONSTRAINT "rider_ledger_entries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rider_ledger_entries" ADD CONSTRAINT "rider_ledger_entries_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rider_ledger_entries" ADD CONSTRAINT "rider_ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rider_settlements" ADD CONSTRAINT "rider_settlements_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rider_settlements" ADD CONSTRAINT "rider_settlements_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rider_settlements" ADD CONSTRAINT "rider_settlements_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
