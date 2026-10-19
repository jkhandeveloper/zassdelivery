-- Customers can collect an order themselves, and can choose which rider
-- delivers it. Riders set their own per-kilometre rate.
ALTER TABLE "drivers" ADD COLUMN "per_km_rate" DECIMAL(8,2);

ALTER TABLE "carts" ADD COLUMN "fulfilment" "order_type" NOT NULL DEFAULT 'DELIVERY',
ADD COLUMN "preferred_driver_id" TEXT;

ALTER TABLE "orders" ADD COLUMN "preferred_driver_id" TEXT;

-- The bounds a rider's own rate must sit within, in PKR per kilometre.
INSERT INTO "settings" ("id", "key", "value", "value_type", "group", "description", "is_public", "updated_at")
VALUES
  (gen_random_uuid()::text, 'delivery.rider_rate_min', '10', 'NUMBER', 'delivery',
   'The lowest per-kilometre rate a rider may set, in PKR.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'delivery.rider_rate_max', '500', 'NUMBER', 'delivery',
   'The highest per-kilometre rate a rider may set, in PKR.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
