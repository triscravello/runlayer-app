-- CreateEnum
CREATE TYPE "BodyType" AS ENUM ('SLIM', 'ATHLETIC', 'BROAD', 'PLUS');

-- CreateEnum
CREATE TYPE "BudgetLevel" AS ENUM ('BUDGET', 'MID', 'PREMIUM');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('TOP', 'BOTTOM', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "PriceRange" AS ENUM ('BUDGET', 'MID', 'PREMIUM');

-- CreateEnum
CREATE TYPE "ConditionKey" AS ENUM ('HOT', 'COLD', 'RAIN', 'WIND', 'HUMID', 'NIGHT');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "height_cm" INTEGER,
    "weight_lbs" INTEGER,
    "body_type" "BodyType",
    "heat_sensitivity" TEXT,
    "chafe_prone" BOOLEAN NOT NULL DEFAULT false,
    "style_preference" TEXT,
    "budget_level" "BudgetLevel",
    "preferred_fit" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather_snapshots" (
    "id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "temp_f" DOUBLE PRECISION,
    "humidity" DOUBLE PRECISION,
    "wind_speed" DOUBLE PRECISION,
    "precipitation_chance" DOUBLE PRECISION,
    "uv_index" DOUBLE PRECISION,
    "condition" TEXT,
    "temp_category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weather_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gear_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "gender_target" TEXT,
    "category" "Category" NOT NULL,
    "subcategory" TEXT,
    "priceRange" "PriceRange" NOT NULL,
    "tags" TEXT[],
    "weather_hot" DOUBLE PRECISION,
    "weather_cold" DOUBLE PRECISION,
    "weather_rain" DOUBLE PRECISION,
    "weather_wind" DOUBLE PRECISION,
    "body_type_fit" TEXT[],
    "image_url" TEXT,
    "affiliate_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gear_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT,
    "style" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "weather_snapshot_id" TEXT,
    "input_context" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "top_score" DOUBLE PRECISION,
    "algorithm_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_outfits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recommendation_id" TEXT,
    "name" TEXT,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_outfits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outfit_items" (
    "id" TEXT NOT NULL,
    "outfit_id" TEXT NOT NULL,
    "gear_item_id" TEXT NOT NULL,
    "category" "Category",

    CONSTRAINT "outfit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_rules" (
    "id" TEXT NOT NULL,
    "condition_key" "ConditionKey" NOT NULL,
    "category" "Category",
    "weight" DOUBLE PRECISION NOT NULL,
    "tags" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "gear_items_name_brand_id_key" ON "gear_items"("name", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_weather_snapshot_id_fkey" FOREIGN KEY ("weather_snapshot_id") REFERENCES "weather_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_outfits" ADD CONSTRAINT "saved_outfits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_outfits" ADD CONSTRAINT "saved_outfits_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_items" ADD CONSTRAINT "outfit_items_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "saved_outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_items" ADD CONSTRAINT "outfit_items_gear_item_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
