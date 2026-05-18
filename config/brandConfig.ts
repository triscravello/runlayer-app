export const BRAND_MULTIPLIERS = {
    preferred: 1.12,
    saved: 1.08,
    neutral: 1,
    disliked: 0.82,
    unknown: 1,
} as const;

export const BRAND_SCORE_LIMITS = {
    minMultiplier: 0.65,
    maxMultiplier: 1.25,
    minScore: 0,
    maxScore: 100,
} as const;