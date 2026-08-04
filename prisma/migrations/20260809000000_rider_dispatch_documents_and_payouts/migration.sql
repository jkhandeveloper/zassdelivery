-- Rider onboarding, dispatch and payouts.
--
-- Four new tables carry the module: the documents backing an application, the
-- dispatch offers put in front of riders, the itemised earnings ledger, and
-- withdrawal requests against a rider's wallet.
--
-- The partial unique indexes at the foot of this file are the ones that matter
-- under concurrency: they are what stop two riders holding the same order, and
-- one rider holding two.

-- CreateEnum
CREATE TYPE "driver_document_type" AS ENUM ('CNIC_FRONT', 'CNIC_BACK', 'DRIVING_LICENSE', 'VEHICLE_REGISTRATION', 'PROFILE_PHOTO');

-- CreateEnum
CREATE TYPE "driver_document_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "driver_earning_type" AS ENUM ('BASE_FARE', 'DISTANCE', 'TIP', 'BONUS', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payout_method" AS ENUM ('BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA');

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "approved_by_id" TEXT,
ADD COLUMN     "online_since" TIMESTAMPTZ(3),
ADD COLUMN     "rejection_reason" VARCHAR(300);

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "type" "driver_document_type" NOT NULL,
    "status" "driver_document_status" NOT NULL DEFAULT 'PENDING',
    "file_url" VARCHAR(500) NOT NULL,
    "number" VARCHAR(60),
    "expires_at" TIMESTAMPTZ(3),
    "rejection_reason" VARCHAR(300),
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_assignments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "status" "assignment_status" NOT NULL DEFAULT 'OFFERED',
    "pickup_distance_km" DECIMAL(6,2),
    "estimated_earning" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "assigned_by_id" TEXT,
    "is_auto" BOOLEAN NOT NULL DEFAULT false,
    "offered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "responded_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "rejection_reason" VARCHAR(300),
    "otp_hash" VARCHAR(255),
    "otp_issued_at" TIMESTAMPTZ(3),
    "otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "otp_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_earnings" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "order_id" TEXT,
    "assignment_id" TEXT,
    "type" "driver_earning_type" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "description" VARCHAR(300),
    "earned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_requests" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "driver_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "payout_method" NOT NULL,
    "status" "payout_status" NOT NULL DEFAULT 'PENDING',
    "bank_name" VARCHAR(120),
    "account_title" VARCHAR(120) NOT NULL,
    "account_number" VARCHAR(40) NOT NULL,
    "processed_by_id" TEXT,
    "processed_at" TIMESTAMPTZ(3),
    "rejection_reason" VARCHAR(300),
    "payment_reference" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_documents_status_created_at_idx" ON "driver_documents"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "driver_documents_driver_id_type_key" ON "driver_documents"("driver_id", "type");

-- CreateIndex
CREATE INDEX "delivery_assignments_driver_id_status_offered_at_idx" ON "delivery_assignments"("driver_id", "status", "offered_at");

-- CreateIndex
CREATE INDEX "delivery_assignments_order_id_status_idx" ON "delivery_assignments"("order_id", "status");

-- CreateIndex
CREATE INDEX "delivery_assignments_status_expires_at_idx" ON "delivery_assignments"("status", "expires_at");

-- CreateIndex
CREATE INDEX "driver_earnings_driver_id_earned_at_idx" ON "driver_earnings"("driver_id", "earned_at");

-- CreateIndex
CREATE INDEX "driver_earnings_order_id_idx" ON "driver_earnings"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_requests_reference_key" ON "payout_requests"("reference");

-- CreateIndex
CREATE INDEX "payout_requests_driver_id_created_at_idx" ON "payout_requests"("driver_id", "created_at");

-- CreateIndex
CREATE INDEX "payout_requests_status_created_at_idx" ON "payout_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "delivery_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_processed_by_id_fkey" FOREIGN KEY ("processed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────
-- Concurrency guards
--
-- Prisma's schema language cannot express a partial unique index, but these
-- are exactly the constraints that must hold when two dispatchers click at the
-- same moment. Enforcing them in the database rather than in application code
-- means a race cannot produce a double-assigned order.
-- ─────────────────────────────────────────────────────────────

-- An order may have at most one live offer or acceptance at a time. Rejected,
-- expired and cancelled rows stay out of the index, so an order can be
-- re-offered as often as it takes to find a rider.
CREATE UNIQUE INDEX "delivery_assignments_live_per_order_idx"
  ON "delivery_assignments" ("order_id")
  WHERE "status" IN ('OFFERED', 'ACCEPTED');

-- A rider carries one delivery at a time. They may hold several outstanding
-- offers, but only one of them can become an acceptance.
CREATE UNIQUE INDEX "delivery_assignments_active_per_driver_idx"
  ON "delivery_assignments" ("driver_id")
  WHERE "status" = 'ACCEPTED';

-- The same order is never offered to the same rider twice while that offer is
-- still live; the dispatcher looks elsewhere instead of nagging.
CREATE UNIQUE INDEX "delivery_assignments_open_offer_idx"
  ON "delivery_assignments" ("order_id", "driver_id")
  WHERE "status" = 'OFFERED';

-- A rider may have only one withdrawal in flight, so the wallet hold and the
-- operator queue stay easy to reason about.
CREATE UNIQUE INDEX "payout_requests_one_pending_per_driver_idx"
  ON "payout_requests" ("driver_id")
  WHERE "status" IN ('PENDING', 'APPROVED');

-- Working the dispatch queue: which riders are online, approved and free.
CREATE INDEX IF NOT EXISTS "drivers_dispatchable_idx"
  ON "drivers" ("zone_id", "availability")
  WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL;

-- Sequence behind the human-readable withdrawal reference (WDR-260809-0001).
-- A sequence rather than COUNT(*)+1: two requests in the same millisecond would
-- otherwise compute the same reference and one would fail at random.
CREATE SEQUENCE IF NOT EXISTS "payout_reference_seq" START 1;
