-- AlterTable
ALTER TABLE "recommendations" ADD COLUMN     "engine_version" TEXT NOT NULL DEFAULT '1.0.0',
ADD COLUMN     "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "recommendation_version_metadata" (
    "id" TEXT NOT NULL,
    "recommendation_id" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_version_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_version_metadata_recommendation_id_key" ON "recommendation_version_metadata"("recommendation_id");

-- CreateIndex
CREATE INDEX "recommendation_version_metadata_engine_version_idx" ON "recommendation_version_metadata"("engine_version");

-- CreateIndex
CREATE INDEX "recommendations_engine_version_idx" ON "recommendations"("engine_version");

-- CreateIndex
CREATE INDEX "recommendations_generated_at_idx" ON "recommendations"("generated_at");

-- AddForeignKey
ALTER TABLE "recommendation_version_metadata" ADD CONSTRAINT "recommendation_version_metadata_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
