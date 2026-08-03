-- Constraints and indexes that Prisma's schema language cannot express.
-- Kept as a hand-written migration so they are versioned like everything else.

-- ─────────────────────────────────────────────────────────────
-- 1. At most one default address per user.
--    A plain @@unique([userId, isDefault]) would wrongly allow only one
--    NON-default address too. A partial index constrains just the `true` rows,
--    and ignores soft-deleted addresses so a deleted default does not block a
--    new one.
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "addresses_one_default_per_user"
  ON "addresses" ("user_id")
  WHERE "is_default" = true AND "deleted_at" IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. Trigram indexes for the `search` query parameter.
--    Every list endpoint supports free-text search, which compiles to
--    ILIKE '%term%'. A btree index cannot serve a leading wildcard, so without
--    these each search is a sequential scan. GIN + gin_trgm_ops makes them
--    index-backed.
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "users_full_name_trgm_idx"
  ON "users" USING GIN ("full_name" gin_trgm_ops);

CREATE INDEX "users_phone_trgm_idx"
  ON "users" USING GIN ("phone" gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────
-- 3. Partial index for the hot "active, non-deleted user" read path.
--    Most queries filter on this combination; indexing only those rows keeps
--    the index small and hot in cache.
-- ─────────────────────────────────────────────────────────────
CREATE INDEX "users_active_not_deleted_idx"
  ON "users" ("created_at" DESC)
  WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL;
