-- ═════════════════════════════════════════════════════════════
-- PostgreSQL full-text search
--
-- The vectors are GENERATED ... STORED columns rather than trigger-maintained
-- ones: Postgres recomputes them on write, so they can never drift out of sync
-- with the row the way a forgotten trigger or an application-side update would.
--
-- The 'simple' text search configuration is used instead of 'english' on
-- purpose. The vocabulary here is transliterated Urdu and Pashto — "karahi",
-- "chapli", "seekh", "biryani" — and English stemming mangles those (it would
-- reduce "karahi" and "karah" to different stems while conflating unrelated
-- words). 'simple' just lower-cases and splits, which is what we want.
--
-- Weighting: the name is weight A, the description weight B, so a query that
-- matches a dish's name outranks one that merely appears in its blurb.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE "restaurants"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("name_ur", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B')
  ) STORED;

CREATE INDEX "restaurants_search_vector_idx"
  ON "restaurants" USING GIN ("search_vector");

ALTER TABLE "menu_items"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("name_ur", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B')
  ) STORED;

CREATE INDEX "menu_items_search_vector_idx"
  ON "menu_items" USING GIN ("search_vector");

-- Categories are a small, fixed set, so a trigram index is enough for the
-- fuzzy matching autocomplete needs — no vector required.
CREATE INDEX "restaurant_categories_name_trgm_idx"
  ON "restaurant_categories" USING GIN ("name" gin_trgm_ops);

-- Trending reads orders placed in a recent window, grouped by restaurant.
-- Indexing only the delivered ones keeps it off the cancelled/failed noise.
CREATE INDEX "orders_trending_idx"
  ON "orders" ("restaurant_id", "created_at" DESC)
  WHERE "status" = 'DELIVERED';
