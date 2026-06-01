-- CreateEnum
CREATE TYPE "RecommendationFeedbackType" AS ENUM ('HELPFUL', 'NOT_HELPFUL');

-- CreateTable
CREATE TABLE "recommendation_items" (
    "id" TEXT NOT NULL,
    "recommendation_id" TEXT NOT NULL,
    "gear_item_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "total_score" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_feedback" (
    "id" TEXT NOT NULL,
    "recommendation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "feedback_type" "RecommendationFeedbackType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_items_recommendation_id_gear_item_id_key" ON "recommendation_items"("recommendation_id", "gear_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_feedback_recommendation_id_user_id_key" ON "recommendation_feedback"("recommendation_id", "user_id");

-- AddForeignKey
ALTER TABLE "recommendation_items" ADD CONSTRAINT "recommendation_items_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_items" ADD CONSTRAINT "recommendation_items_gear_item_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendation_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
