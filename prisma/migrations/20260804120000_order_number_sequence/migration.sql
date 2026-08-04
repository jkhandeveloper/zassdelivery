-- Order numbers are quoted by customers on the phone and printed on kitchen
-- tickets, so they must be short, human-readable and unique.
--
-- A sequence rather than COUNT(*)+1: two checkouts landing in the same
-- millisecond would otherwise compute the same number, and the unique index on
-- order_number would fail one of them at random.
CREATE SEQUENCE IF NOT EXISTS "order_number_seq" START 1;

-- The customer's "my orders" screen, and the rider's active-delivery view.
CREATE INDEX IF NOT EXISTS "orders_customer_history_idx"
  ON "orders" ("customer_id", "created_at" DESC);

-- Refunds are looked up by the payment they reverse.
CREATE INDEX IF NOT EXISTS "transactions_payment_type_idx"
  ON "transactions" ("payment_id", "type");
