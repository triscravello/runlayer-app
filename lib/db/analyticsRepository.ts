import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

export type CountByName = {
    name: string;
    count: number;
};

export type PlatformAnalyticsData = {
    summary: {
        totalRecommendations: number;
        recommendationsThisWeek: number;
        recommendationsThisMonth: number;
        savedKitsCreated: number;
        feedbackSubmissionRate: number;
        helpfulFeedbackPercent: number;
    };
    brands: {
        mostRecommended: CountByName[];
        mostSaved: CountByName[];
        mostCompared: CountByName[];
        mostViewed: CountByName[];
    };
    weather: {
        mostCommonConditions: CountByName[];
        coldWeatherRecommendations: number;
        hotWeatherRecommendations: number;
        rainRecommendations: number;
    };
    workouts: {
        easyRunRecommendations: number;
        tempoRecommendations: number;
        raceDayRecommendations: number;
        recoveryRecommendations: number;
    };
    feedback: {
        totalFeedback: number;
        helpfulFeedback: number;
        notHelpfulFeedback: number;
        submissionRate: number;
        helpfulPercent: number;
    };
    engineVersions: CountByName[];
};

export type UserInsightsData = {
    totals: {
        recommendations: number;
        savedKits: number;
        feedback: number;
    };
    preferences: Array<{
        label: string;
        value: string;
        explanation: string;
    }>;
    patterns: CountByName[];
    brandAffinities: Array<CountByName & { explanation: string }>;
    weather: Array<{
        label: string;
        count: number;
        explanation: string;
    }>;
};

type RawCountByName = { name: string | null; count: bigint | number | null };
type RawWeatherBucket = { label: string | null; count: bigint | number | null };

type DateRange = {
    weekStart: Date;
    monthStart: Date;
};

function toNumber(value: bigint | number | null | undefined) {
    if (typeof value === "bigint") return Number(value);
    return Number(value ?? 0);
}

function normalizeCounts(rows: RawCountByName[]): CountByName[] {
    return rows
        .map((row) => ({ name: row.name ?? "Unknown", count: toNumber(row.count) }))
        .filter((row) => row.count > 0);
}

function getDateRange(now = new Date()): DateRange {
    const weekStart = new Date(now);
    const day = weekStart.getUTCDay();
    const diffToMonday = (day + 6) % 7;
    weekStart.setUTCDate(weekStart.getUTCDate() - diffToMonday);
    weekStart.setUTCHours(0, 0, 0, 0);

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { weekStart, monthStart };
}

async function getMostRecommendedBrands(userId?: string, limit = 8) {
    const userFilter = userId ? Prisma.sql`AND r."user_id" = ${userId}` : Prisma.empty;

    const rows = await prisma.$queryRaw<RawCountByName[]>`
        SELECT b.name, COUNT(*)::bigint AS count
        FROM "recommendation_items" ri
        INNER JOIN "recommendations" r ON r.id = ri."recommendation_id"
        INNER JOIN "gear_items" gi ON gi.id = ri."gear_item_id"
        INNER JOIN "brands" b ON b.id = gi."brand_id"
        WHERE 1 = 1 ${userFilter}
        GROUP BY b.name
        ORDER BY count DESC, b.name ASC
        LIMIT ${limit}
    `;

    return normalizeCounts(rows);
}

async function getMostSavedBrands(userId?: string, limit = 8) {
    const userFilter = userId ? Prisma.sql`AND so."user_id" = ${userId}` : Prisma.empty;

    const rows = await prisma.$queryRaw<RawCountByName[]>`
        SELECT b.name, COUNT(*)::bigint AS count
        FROM "outfit_items" oi
        INNER JOIN "saved_outfits" so ON so.id = oi."outfit_id"
        INNER JOIN "gear_items" gi ON gi.id = oi."gear_item_id"
        INNER JOIN "brands" b ON b.id = gi."brand_id"
        WHERE 1 = 1 ${userFilter}
        GROUP BY b.name
        ORDER BY count DESC, b.name ASC
        LIMIT ${limit}
    `;

    return normalizeCounts(rows);
}

async function getMostCommonConditions(userId?: string, limit = 8) {
    const userFilter = userId ? Prisma.sql`AND r."user_id" = ${userId}` : Prisma.empty;

    const rows = await prisma.$queryRaw<RawCountByName[]>`
        SELECT COALESCE(ws.condition, ws."temp_category", 'Uncaptured weather') AS name, COUNT(*)::bigint AS count
        FROM "recommendations" r
        LEFT JOIN "weather_snapshots" ws ON ws.id = r."weather_snapshot_id"
        WHERE 1 = 1 ${userFilter}
        GROUP BY COALESCE(ws.condition, ws."temp_category", 'Uncaptured weather')
        ORDER BY count DESC, name ASC
        LIMIT ${limit}
    `;

    return normalizeCounts(rows);
}

async function getWeatherBuckets(userId?: string) {
    const userFilter = userId ? Prisma.sql`AND r."user_id" = ${userId}` : Prisma.empty;

    const rows = await prisma.$queryRaw<Array<{ cold: bigint | number; hot: bigint | number; rain: bigint | number }>>`
        SELECT
            COUNT(*) FILTER (
                WHERE ws."temp_f" <= 55
                    OR LOWER(COALESCE(ws."temp_category", '')) LIKE '%cold%'
                    OR LOWER(COALESCE(ws.condition, '')) LIKE '%cold%'
                    OR LOWER(COALESCE(ws.condition, '')) LIKE '%snow%'
            )::bigint AS cold,
            COUNT(*) FILTER (
                WHERE ws."temp_f" >= 80
                    OR LOWER(COALESCE(ws."temp_category", '')) LIKE '%hot%'
                    OR LOWER(COALESCE(ws.condition, '')) LIKE '%hot%'
                    OR LOWER(COALESCE(ws.condition, '')) LIKE '%humid%'
            )::bigint AS hot,
            COUNT(*) FILTER (
                WHERE COALESCE(ws."precipitation_chance", 0) >= 0.3
                    OR LOWER(COALESCE(ws.condition, '')) LIKE '%rain%'
            )::bigint AS rain,
        FROM "recommendations" r
        LEFT JOIN "weather_snapshots" ws ON ws.id = r."weather_snapshot_id"
        WHERE 1 = 1 ${userFilter}
    `;

    const row = rows[0];
    return {
        coldWeatherRecommendations: toNumber(row?.cold),
        hotWeatherRecommendations: toNumber(row?.hot),
        rainRecommendations: toNumber(row?.rain),
    };
}

async function getWorkoutBuckets(userId?: string) {
    const userFilter = userId ? Prisma.sql`AND "user_id" = ${userId}` : Prisma.empty;

    const rows = await prisma.$queryRaw<Array<{ easy: bigint | number; tempo: bigint | number; race: bigint | number; recovery: bigint | number }>>`
        SELECT
            COUNT(*) FILTER (WHERE LOWER(COALESCE("input_context"->>'workoutType', '')) LIKE '%easy%'):: bigint AS easy,
            COUNT(*) FILTER (WHERE LOWER(COALESCE("input_context"->>'workoutType', '')) LIKE '%tempo%'):: bigint AS tempo,
            COUNT(*) FILTER (WHERE LOWER(COALESCE("input_context"->>'workoutType', '')) LIKE '%race%'):: bigint AS race,
            COUNT(*) FILTER (WHERE LOWER(COALESCE("input_context"->>'workoutType', '')) LIKE '%recovery%'):: bigint AS recovery
        FROM "recommendations"
        WHERE 1 = 1 ${userFilter}
    `;

    const row = rows[0];
    return {
        easyRunRecommendations: toNumber(row?.easy),
        tempoRecommendations: toNumber(row?.tempo),
        raceDayRecommendations: toNumber(row?.race),
        recoveryRecommendations: toNumber(row?.recovery),
    };
}

async function getEngineVersionCounts(limit = 8) {
    const rows = await prisma.$queryRaw<RawCountByName[]>`
        SELECT COALESCE("engine_version", "algorithm_version", 'unknown') AS name, COUNT(*)::bigint AS count
        FROM "recommendations"
        GROUP BY COALESCE("engine_version", "algorithm_version", 'unknown')
        ORDER BY count DESC, name ASC
        LIMIT ${limit}
    `;

    return normalizeCounts(rows);
}

async function getWorkoutPatterns(userId: string, limit = 8) {
    const rows = await prisma.$queryRaw<RawCountByName[]>`
        SELECT COALESCE(NULLIF("input_context"->>'workoutType', ''), 'Uncaptured workout') AS name, COUNT(*)::bigint AS count
        FROM "recommendations"
        WHERE "user_id" = ${userId}
        GROUP BY COALESCE(NULLIF("input_context"->>'workoutType', ''), 'Uncaptured workout')
        ORDER BY count DESC, name ASC
        LIMIT ${limit}
    `;

    return normalizeCounts(rows);
}

async function getTagPreferences(userId: string, limit = 8) {
    const rows = await prisma.$queryRaw<RawCountByName[]>`
        SELECT tag AS name, COUNT(*)::bigint AS count
        FROM "recommendation_items" ri
        INNER JOIN "recommendations" r ON r.id = ri."recommendation_id"
        INNER JOIN "gear_items" gi ON gi.id = ri."gear_item_id"
        CROSS JOIN LATERAL unnest(gi.tags) AS tag
        WHERE r."user_id" = ${userId}
        GROUP BY tag
        ORDER BY count DESC, tag ASC
        LIMIT ${limit}
    `;

    return normalizeCounts(rows);
}

async function getWeatherRanges(userId: string, limit = 5) {
    const rows = await prisma.$queryRaw<RawWeatherBucket[]>`
        SELECT
            CASE
                WHEN ws."temp_f" IS NULL THEN 'Temperature not captured'
                WHEN ws."temp_f" < 55 THEN '<55°F'
                WHEN ws."temp_f" < 70 THEN '55–69°F'
                WHEN ws."temp_f" < 86 THEN '70–85°F'
                ELSE '86°F+'
            END AS label,
            COUNT(*)::bigint AS count
        FROM "recommendations" r
        LEFT JOIN "weather_snapshots" ws ON ws.id = r."weather_snapshot_id"
        WHERE r."user_id" = ${userId}
        GROUP BY label
        ORDER BY count DESC, label ASC
        LIMIT ${limit}
    `;

    return rows.map((row) => ({ label: row.label ?? "Unknown", count: toNumber(row.count) })).filter((row) => row.count > 0);
}

export async function getPlatformAnalytics(): Promise<PlatformAnalyticsData> {
    const { weekStart, monthStart } = getDateRange();

    const [
        totalRecommendations,
        recommendationsThisWeek,
        recommendationsThisMonth,
        savedKitsCreated,
        feedbackCount,
        helpfulFeedback,
        notHelpfulFeedback,
        recommendedBrands,
        savedBrands,
        commonConditions,
        weatherBuckets,
        workoutBuckets,
        engineVersions,
    ] = await Promise.all([
        prisma.recommendation.count(),
        prisma.recommendation.count({ where: { generatedAt: { gte: weekStart } } }),
        prisma.recommendation.count({ where: { generatedAt: { gte: monthStart } } }),
        prisma.savedOutfit.count(),
        prisma.recommendationFeedback.count(),
        prisma.recommendationFeedback.count({ where: { feedbackType: "HELPFUL" } }),
        prisma.recommendationFeedback.count({ where: { feedbackType: "NOT_HELPFUL" } }),
        getMostRecommendedBrands(),
        getMostSavedBrands(),
        getMostCommonConditions(),
        getWeatherBuckets(),
        getWorkoutBuckets(),
        getEngineVersionCounts(),
    ]);

    const feedbackSubmissionRate = totalRecommendations ? feedbackCount / totalRecommendations : 0;
    const helpfulFeedbackPercent = feedbackCount ? helpfulFeedback / feedbackCount : 0;

    return {
        summary: {
            totalRecommendations,
            recommendationsThisWeek,
            recommendationsThisMonth,
            savedKitsCreated,
            feedbackSubmissionRate,
            helpfulFeedbackPercent,
        },
        brands: {
            mostRecommended: recommendedBrands,
            mostSaved: savedBrands,
            mostCompared: [],
            mostViewed: [],
        },
        weather: {
            mostCommonConditions: commonConditions,
            ...weatherBuckets,
        },
        workouts: workoutBuckets,
        feedback: {
            totalFeedback: feedbackCount,
            helpfulFeedback,
            notHelpfulFeedback,
            submissionRate: feedbackSubmissionRate,
            helpfulPercent: helpfulFeedbackPercent,
        },
        engineVersions,
    };
}

export async function getUserRecommendationInsights(userId: string): Promise<UserInsightsData> {
    const [recommendations, savedKits, feedback, tags, patterns, savedBrands, recommendedBrands, weatherRanges, weatherConditions, profile] = await Promise.all([
        prisma.recommendation.count({ where: { userId } }),
        prisma.savedOutfit.count({ where: {userId } }),
        prisma.recommendationFeedback.count({ where: { userId } }),
        getTagPreferences(userId),
        getWorkoutPatterns(userId),
        getMostSavedBrands(userId),
        getMostRecommendedBrands(userId),
        getWeatherRanges(userId),
        getMostCommonConditions(userId),
        prisma.userProfile.findUnique({ where: { userId } }),
    ]);

    const preferences = tags.slice(0, 4).map((tag) => ({
        label: tag.name,
        value: `${tag.count} recommended items`,
        explanation: `${tag.name} appears because ${tag.count} recommended gear item${tag.count === 1 ? "" : "s"} in your history carry that tag.`,
    }));

    if (profile?.terrainPreference) {
        preferences.push({
            label: `${profile.terrainPreference} running`,
            value: "Profile preference",
            explanation: `${profile.terrainPreference} appears because it is saved in your profile terrain preference.`
        });
    }

    const primaryBrandSource = savedBrands.length ? savedBrands : recommendedBrands;
    const brandAffinities = primaryBrandSource.slice(0, 5).map((brand) => {
        const denominator = savedBrands.length ? Math.max(savedKits, 1) : Math.max(recommendations, 1);
        const percent = Math.round((brand.count / denominator) * 100);
        const source = savedBrands.length ? "saved kits" : "recommendation history";
        return {
            ...brand,
            explanation: `${brand.name} appears frequently because it is present in ${brand.count} ${source} record${brand.count === 1 ? "" : "s"} (${percent}% of your ${source}).`,
        };
    });

    const weather = [
        ...weatherRanges.map((range) => ({
            label: range.label,
            count: range.count,
            explanation: `${range.label} appears because ${range.count} recommendation${range.count === 1 ? "" : "s"} were generated in this tempature range.`,
        })),
        ...weatherConditions.slice(0, 3).map((condition) => ({
            label: condition.name,
            count: condition.count,
            explanation: `${condition.name} appeats because ${condition.count} recommendation${condition.count === 1 ? "" : "s"} used that weather condition snapshot.`,
        })),
    ];

    return {
        totals: { recommendations, savedKits, feedback },
        preferences,
        patterns,
        brandAffinities,
        weather,
    };
}