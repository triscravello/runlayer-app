"use client";

import { useState, useTransition } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "../ui/Button";
import { recommendationService, type FeedbackType } from "@/services/recommendationService";

export type RecommendationFeedbackControlsProps = {
    recommendationId?: string;
    userId?: string;
    initialFeedback?: FeedbackType | null;
}

export function RecommendationFeedbackControls({ recommendationId, userId, initialFeedback = null }: RecommendationFeedbackControlsProps ) {
    const [feedback, setFeedback] = useState<FeedbackType | null>(initialFeedback);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    function submitFeedback(feedbackType: FeedbackType) {
        if (!recommendationId) return;

        const previousFeedback = feedback;
        setFeedback(feedbackType);
        setError("");

        startTransition(async () => {
            try {
                await recommendationService.submitFeedback({ userId, recommendationId, feedbackType });
            } catch (err) {
                setFeedback(previousFeedback);
                setError(err instanceof Error ? err.message : "Unable to submit feedback.");
            }
        });
    }

    return (
        <div className="space-y-2" aria-label="Recommendation feedback">
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant={feedback === "HELPFUL" ? "default" : "outline"}
                    size="sm"
                    disabled={!recommendationId || isPending}
                    onClick={() => submitFeedback("HELPFUL")}
                >
                    <ThumbsUp className="size-4" /> Helpful
                </Button>
                <Button
                    type="button"
                    variant={feedback === "NOT_HELPFUL" ? "default" : "outline"}
                    size="sm"
                    disabled={!recommendationId || isPending}
                    onClick={() => submitFeedback("NOT_HELPFUL")}
                >
                    <ThumbsDown className="size-4" /> Not Helpful
                </Button>
            </div>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
    )
}