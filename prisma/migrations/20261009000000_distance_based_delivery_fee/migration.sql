-- Delivery is now priced by the kilometre and capped, from platform settings
-- rather than from each zone's fee bands. The API falls back to these same
-- figures when a key is absent; the rows are created here so an administrator
-- can see and change them from the settings screen, which only edits settings
-- that already exist. Existing values are left alone.
INSERT INTO "settings" ("id", "key", "value", "value_type", "group", "description", "is_public", "updated_at")
VALUES
  (gen_random_uuid()::text, 'delivery.per_km_fee', '50', 'NUMBER', 'delivery',
   'Delivery fee per kilometre between the business and the customer, in PKR. The rider keeps it.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'delivery.min_fee', '50', 'NUMBER', 'delivery',
   'The least a delivery costs, however short the run, in PKR.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'delivery.max_fee', '150', 'NUMBER', 'delivery',
   'The most a delivery costs, in PKR.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'delivery.max_distance_km', '3', 'NUMBER', 'delivery',
   'Orders are not delivered further than this from the business, in kilometres.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
