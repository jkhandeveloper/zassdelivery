-- AlterTable
-- Set only for VENDOR_STAFF accounts: the single restaurant this account
-- works for, so a staff login can never be used against another vendor's
-- listing.
ALTER TABLE "users" ADD COLUMN "staff_restaurant_id" TEXT;

-- CreateIndex
CREATE INDEX "users_staff_restaurant_id_idx" ON "users"("staff_restaurant_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_staff_restaurant_id_fkey" FOREIGN KEY ("staff_restaurant_id") REFERENCES "restaurants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
