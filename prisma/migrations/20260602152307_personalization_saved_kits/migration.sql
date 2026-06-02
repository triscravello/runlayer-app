-- AlterTable
ALTER TABLE "saved_outfits" ADD COLUMN     "description" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'custom',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "avoided_brands" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "budget_sensitivity" TEXT,
ADD COLUMN     "cold_tolerance" TEXT,
ADD COLUMN     "heat_tolerance" TEXT,
ADD COLUMN     "preferred_brands" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "terrain_preference" TEXT;
