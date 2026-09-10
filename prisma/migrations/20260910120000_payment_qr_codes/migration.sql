-- Scan-to-pay: a customer pays the restaurant or the rider directly by scanning
-- their JazzCash, Easypaisa or bank QR, and the recipient confirms receipt.
ALTER TYPE "payment_method" ADD VALUE IF NOT EXISTS 'QR_TRANSFER';

-- The QR destinations themselves, as a small JSON list per payee. Kept on the
-- payee's own row because they are only ever read and written as a whole.
ALTER TABLE "restaurants" ADD COLUMN "payment_qr_codes" JSONB;
ALTER TABLE "drivers" ADD COLUMN "payment_qr_codes" JSONB;
