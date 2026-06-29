-- CreateTable
CREATE TABLE "gear_item_variants" (
    "id" TEXT NOT NULL,
    "gear_item_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "affiliate_url" TEXT,
    "image_url" TEXT,
    "price" DOUBLE PRECISION,
    "sizes" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gear_item_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gear_item_variants_gear_item_id_idx" ON "gear_item_variants"("gear_item_id");

-- CreateIndex
CREATE INDEX "gear_item_variants_gender_idx" ON "gear_item_variants"("gender");

-- CreateIndex
CREATE UNIQUE INDEX "gear_item_variants_gear_item_id_label_gender_key" ON "gear_item_variants"("gear_item_id", "label", "gender");

-- AddForeignKey
ALTER TABLE "gear_item_variants" ADD CONSTRAINT "gear_item_variants_gear_item_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
