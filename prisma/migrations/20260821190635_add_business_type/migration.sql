-- Hand-trimmed. `prisma migrate dev` also proposed dropping the trigram and
-- GIN indexes, and the generated `search_vector` defaults, that earlier raw-SQL
-- migrations created: Prisma cannot see either through `Unsupported()`, so it
-- reads them as drift. Those statements are destructive and unrelated to this
-- change, so only the business type is applied here.

-- CreateEnum
CREATE TYPE "business_type" AS ENUM ('RESTAURANT', 'CAFE', 'BAKERY', 'CAFETERIA', 'FAST_FOOD', 'DHABA', 'SWEET_SHOP', 'JUICE_CORNER', 'DESSERT_PARLOUR', 'HOME_KITCHEN', 'CLOUD_KITCHEN', 'GROCERY');

-- AlterTable
-- Defaulted to RESTAURANT so every listing that predates the column keeps the
-- meaning it already had.
ALTER TABLE "restaurants" ADD COLUMN "business_type" "business_type" NOT NULL DEFAULT 'RESTAURANT';

-- CreateIndex
CREATE INDEX "restaurants_business_type_status_idx" ON "restaurants"("business_type", "status");
