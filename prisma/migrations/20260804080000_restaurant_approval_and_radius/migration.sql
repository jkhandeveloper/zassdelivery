-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "approved_by_id" TEXT,
ADD COLUMN     "delivery_radius_meters" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN     "rejection_reason" VARCHAR(500),
ADD COLUMN     "submitted_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "restaurants_status_created_at_idx" ON "restaurants"("status", "created_at");

-- AddForeignKey
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A restaurant must be willing to deliver some distance, and an unbounded
-- radius would silently opt it into orders far outside its zone.
ALTER TABLE "restaurants"
  ADD CONSTRAINT "restaurants_delivery_radius_range"
    CHECK ("delivery_radius_meters" > 0 AND "delivery_radius_meters" <= 50000);

-- Opening hours are stored as local "HH:mm" strings; the format is enforced
-- here so a malformed value can never reach the is-open calculation.
ALTER TABLE "restaurant_hours"
  ADD CONSTRAINT "restaurant_hours_time_format"
    CHECK (
      "opens_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
      "closes_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    );

-- The approval queue is read constantly by staff and is a tiny slice of the
-- table, so it gets its own partial index.
CREATE INDEX "restaurants_pending_approval_idx"
  ON "restaurants" ("submitted_at" ASC)
  WHERE "status" = 'PENDING_APPROVAL' AND "deleted_at" IS NULL;
