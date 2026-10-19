#!/bin/sh
# ─────────────────────────────────────────────────────────────
# Fails when prisma/schema.prisma has changes no migration carries.
#
# Run against a database that has had `prisma migrate deploy` applied. A few
# objects are created by hand-written SQL in migrations because Prisma cannot
# express them — trigram and partial indexes, generated search columns — so
# Prisma always reports them as drift. Those exact statements are allowed;
# anything else means a migration is missing.
#
# Usage: DATABASE_URL=... scripts/check-migrations.sh
# ─────────────────────────────────────────────────────────────
set -eu

ALLOWED='^DROP INDEX "(menu_items_name_trgm_idx|orders_customer_history_idx|restaurant_categories_name_trgm_idx|restaurants_name_trgm_idx|transactions_payment_type_idx|users_full_name_trgm_idx|users_phone_trgm_idx)";$|^ALTER TABLE "(menu_items|restaurants)" ALTER COLUMN "search_vector" DROP DEFAULT;$'

drift=$(npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script 2>/dev/null |
  grep -v '^--' | grep -v '^[[:space:]]*$' | grep -Ev "$ALLOWED" || true)

if [ -n "$drift" ]; then
  echo "schema.prisma has changes that no migration applies:"
  echo "$drift"
  echo
  echo "Create one with: npx prisma migrate dev --name <change>"
  exit 1
fi

echo "Migrations match schema.prisma."
