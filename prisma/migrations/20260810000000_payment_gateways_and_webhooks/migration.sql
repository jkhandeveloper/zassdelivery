-- Online payments: JazzCash and Easypaisa checkout, verification and webhooks.
--
-- Two additions carry the module. `payments.reference` is the merchant
-- transaction id we send to a gateway and it echoes back on every callback,
-- which is how an unsolicited notification is matched to an attempt.
-- `webhook_events` is the log of everything a gateway has ever told us, written
-- before the payload is trusted — it is what answers "the customer says they
-- paid" after the fact, and what makes a redelivered callback free.

-- CreateEnum
CREATE TYPE "webhook_status" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'INVALID', 'FAILED');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "reference" VARCHAR(40);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "gateway" VARCHAR(40) NOT NULL,
    "event_id" VARCHAR(160) NOT NULL,
    "status" "webhook_status" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "signature" VARCHAR(255),
    "payment_id" TEXT,
    "error" VARCHAR(500),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "webhook_events_payment_id_idx" ON "webhook_events"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_gateway_event_id_key" ON "webhook_events"("gateway", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE INDEX "payments_method_status_idx" ON "payments"("method", "status");

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Sequence behind the payment reference (PAY-260810-0001). A sequence rather
-- than COUNT(*)+1: two checkouts in the same millisecond would otherwise
-- compute the same reference, and a gateway would see two different payments
-- claiming one merchant id.
CREATE SEQUENCE IF NOT EXISTS "payment_reference_seq" START 1;

-- The reconciliation queue: online payments still waiting on a gateway, oldest
-- first. Partial, because settled payments are the overwhelming majority and
-- have no business in this index.
CREATE INDEX IF NOT EXISTS "payments_awaiting_gateway_idx"
  ON "payments" ("created_at")
  WHERE "status" IN ('PENDING', 'AUTHORIZED') AND "gateway_name" IS NOT NULL;

-- Webhook events that still need attention, for the operator queue and retries.
CREATE INDEX IF NOT EXISTS "webhook_events_unresolved_idx"
  ON "webhook_events" ("received_at")
  WHERE "status" IN ('RECEIVED', 'FAILED');
