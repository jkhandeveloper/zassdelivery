-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "available_days" "day_of_week"[],
ADD COLUMN     "available_from" VARCHAR(5),
ADD COLUMN     "available_to" VARCHAR(5),
ADD COLUMN     "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "stock_quantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "track_inventory" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "menu_variants" ADD COLUMN     "stock_quantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "track_inventory" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "menu_item_images" (
    "id" TEXT NOT NULL,
    "menu_item_id" TEXT NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "caption" VARCHAR(180),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_item_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_item_images_menu_item_id_sort_order_idx" ON "menu_item_images"("menu_item_id", "sort_order");

-- AddForeignKey
ALTER TABLE "menu_item_images" ADD CONSTRAINT "menu_item_images_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Stock can never go negative: a race between two checkouts must fail loudly
-- at the database rather than silently overselling the kitchen.
ALTER TABLE "menu_items"
  ADD CONSTRAINT "menu_items_stock_non_negative"
    CHECK ("stock_quantity" >= 0 AND "low_stock_threshold" >= 0),
  ADD CONSTRAINT "menu_items_availability_window_format"
    CHECK (
      ("available_from" IS NULL OR "available_from" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND
      ("available_to"   IS NULL OR "available_to"   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    ),
  -- A half-specified window is ambiguous; require both bounds or neither.
  ADD CONSTRAINT "menu_items_availability_window_paired"
    CHECK (("available_from" IS NULL) = ("available_to" IS NULL));

ALTER TABLE "menu_variants"
  ADD CONSTRAINT "menu_variants_stock_non_negative" CHECK ("stock_quantity" >= 0),
  ADD CONSTRAINT "menu_variants_price_non_negative" CHECK ("price" >= 0);

-- The owner's "what is running low" view reads only tracked items.
CREATE INDEX "menu_items_low_stock_idx"
  ON "menu_items" ("restaurant_id", "stock_quantity")
  WHERE "track_inventory" = true AND "deleted_at" IS NULL;
