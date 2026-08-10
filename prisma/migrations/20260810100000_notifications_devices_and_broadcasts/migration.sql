-- Notifications: device tokens, push delivery and admin broadcasts.
--
-- `device_tokens` replaces the single `users.push_token` field with one row per
-- installation: people carry a phone and a tablet, and a notification that only
-- reaches whichever device logged in last is a notification that gets missed.
--
-- `broadcasts` gives a campaign its own record, so "who did we send this to and
-- did it arrive" has one row to answer it, and so a campaign can be composed and
-- reviewed before anybody receives anything.

-- CreateEnum
CREATE TYPE "device_platform" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- CreateEnum
CREATE TYPE "broadcast_audience" AS ENUM ('ALL', 'ROLE', 'ZONE', 'ACTIVE_CUSTOMERS', 'USER_IDS');

-- CreateEnum
CREATE TYPE "broadcast_status" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "broadcast_id" TEXT,
ADD COLUMN     "push_error" VARCHAR(300),
ADD COLUMN     "push_sent_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "platform" "device_platform" NOT NULL DEFAULT 'ANDROID',
    "device_id" VARCHAR(120),
    "device_name" VARCHAR(120),
    "app_version" VARCHAR(40),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(300),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "type" "notification_type" NOT NULL DEFAULT 'PROMOTION',
    "data" JSONB,
    "audience" "broadcast_audience" NOT NULL DEFAULT 'ALL',
    "role_filter" "user_role",
    "zone_id" TEXT,
    "user_ids" TEXT[],
    "channels" "notification_channel"[],
    "status" "broadcast_status" NOT NULL DEFAULT 'DRAFT',
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "scheduled_for" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "error" VARCHAR(500),
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_is_active_idx" ON "device_tokens"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "device_tokens_is_active_last_used_at_idx" ON "device_tokens"("is_active", "last_used_at");

-- CreateIndex
CREATE INDEX "broadcasts_status_scheduled_for_idx" ON "broadcasts"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "broadcasts_created_at_idx" ON "broadcasts"("created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_type_created_at_idx" ON "notifications"("user_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "notifications_broadcast_id_idx" ON "notifications"("broadcast_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The unread badge, which the app asks for on every foreground. Partial, because
-- read notifications are the overwhelming majority and have no business here.
CREATE INDEX IF NOT EXISTS "notifications_unread_idx"
  ON "notifications" ("user_id", "created_at" DESC)
  WHERE "is_read" = false;

-- The push fan-out: every live device for a set of users, in one index scan.
CREATE INDEX IF NOT EXISTS "device_tokens_deliverable_idx"
  ON "device_tokens" ("user_id")
  WHERE "is_active" = true;

-- Campaigns waiting for their moment, for the scheduler sweep.
CREATE INDEX IF NOT EXISTS "broadcasts_due_idx"
  ON "broadcasts" ("scheduled_for")
  WHERE "status" = 'SCHEDULED';
