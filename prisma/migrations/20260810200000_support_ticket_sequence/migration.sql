-- Human-readable support ticket references (TKT-260810-0001).
--
-- A sequence rather than COUNT(*)+1, for the same reason order numbers use one:
-- two tickets opened in the same millisecond would otherwise compute the same
-- reference, and the unique index would reject one of them at random — during
-- an incident, which is exactly when several people open tickets at once.
CREATE SEQUENCE IF NOT EXISTS "support_ticket_seq" START 1;

-- The support queue as an agent works it: everything still awaiting somebody,
-- most urgent first. Partial, because closed tickets are the majority and have
-- no business in the working index.
CREATE INDEX IF NOT EXISTS "support_tickets_queue_idx"
  ON "support_tickets" ("priority" DESC, "created_at" ASC)
  WHERE "status" IN ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER');

-- Live banners for one placement, which every app home screen asks for.
CREATE INDEX IF NOT EXISTS "banners_live_idx"
  ON "banners" ("placement", "sort_order")
  WHERE "is_active" = true;

-- Coupons a customer could actually redeem right now.
CREATE INDEX IF NOT EXISTS "coupons_live_idx"
  ON "coupons" ("expires_at")
  WHERE "is_active" = true;
