import assert from "node:assert/strict";
import test from "node:test";
import { deleteRecommendationHistoryById } from "./recommendationRepository";
import { prisma } from "../prisma";

test("deleteRecommendationHistoryById deletes scoped parent after clearing related history rows", async (t) => {
    const calls: string[] = [];
    const tx = {
        recommendation: {
            findFirst: t.mock.fn(async (args) => {
                calls.push("recommendation.findFirst");
                assert.deepEqual(args, {
                    where: { id: "recommendation-1", userId: "user-1" },
                    select: { id: true },
                });
                return { id: "recommendation-1" };
            }),
            deleteMany: t.mock.fn(async (args) => {
                calls.push("recommendation.deleteMany");
                assert.deepEqual(args, {
                    where: { id: "recommendation-1", userId: "user-1" },
                });
                return { count: 1 };
            }),
        },
        savedOutfit: {
            updateMany: t.mock.fn(async (args) => {
                calls.push("savedOutfit.updateMany");
                assert.deepEqual(args, {
                    where: { recommendationId: "recommendation-1" },
                    data: { recommendationId: null },
                });
                return { count: 1 };
            }),
        },
        recommendationFeedback: {
            deleteMany: t.mock.fn(async (args) => {
                calls.push("recommendationFeedback.deleteMany");
                assert.deepEqual(args, {
                    where: { recommendation: { recommendationId: "recommendation-1" } },
                });
                return { count: 2 };
            }),
        },
        recommendationItem: {
            deleteMany: t.mock.fn(async (args) => {
                calls.push("recommendationItem.deleteMany");
                assert.deepEqual(args, {
                    where: { recommendationId: "recommendation-1" },
                });
                return { count: 3 };
            }),
        },
        recommendationVersionMetadata: {
            deleteMany: t.mock.fn(async (args) => {
                calls.push("recommendationVersionMetadata.deleteMany");
                assert.deepEqual(args, {
                    where: { recommendationId: "recommendation-1" },
                });
                return { count: 1 };
            }),
        },
    };

    t.mock.method(prisma, "$transaction", async (callback: (transactionClient: typeof tx) => Promise<{ count: number }>) => callback(tx));

    const result = await deleteRecommendationHistoryById("user-1", "recommendation-1");

    assert.deepEqual(result, { count: 1 });
    assert.deepEqual(calls, [
        "recommendation.findFirst",
        "savedOutfit.updateMany",
        "recommendationFeedback.deleteMany",
        "recommendationItem.deleteMany",
        "recommendationVersionMetadata.deleteMany",
        "recommendation.deleteMany",
    ]);
});

test("deleteRecommendationHistoryById returns zero without deleting rows for a non-owned recommendation", async (t) => {
    const tx = {
        recommendation: {
            findFirst: t.mock.fn(async (args) => {
                assert.deepEqual(args, {
                    where: { id: "recommendation-1", userId: "user-2" },
                    select: { id: true },
                });
                return null;
            }),
            deleteMany: t.mock.fn(),
        },
        savedOutfit: { updateMany: t.mock.fn() },
        recommendationFeedback: { deleteMany: t.mock.fn() },
        recommendationItem: { deleteMany: t.mock.fn() },
        recommendationVersionMetadata: { deleteMany: t.mock.fn() },
    };

    t.mock.method(prisma, "$transaction", async (callback: (transactionClient: typeof tx) => Promise<{ count: number }>) => callback(tx));

    const result = await deleteRecommendationHistoryById("user-2", "recommendation-1");

    assert.deepEqual(result, { count: 0 });
    assert.equal(tx.recommendation.deleteMany.mock.callCount(), 0);
    assert.equal(tx.savedOutfit.updateMany.mock.callCount(), 0);
    assert.equal(tx.recommendationFeedback.deleteMany.mock.callCount(), 0);
    assert.equal(tx.recommendationItem.deleteMany.mock.callCount(), 0);
    assert.equal(tx.recommendationVersionMetadata.deleteMany.mock.callCount(), 0);
});

test("createRecommendationHistory creates a weather snapshot with generated recommendation history", async (t) => {
    const { createRecommendationHistory } = await import("./recommendationRepository");
    const createdAt = new Date("2026-06-29T12:00:00.000Z");
    const weatherSnapshotCreate = t.mock.fn(async (args) => {
        assert.deepEqual(args, {
            data: {
                location: "Boston, MA",
                latitude: null,
                longitude: null,
                tempF: 42,
                humidity: 81,
                windSpeed: 12,
                precipitationChance: 0.6,
                uvIndex: 2,
                condition: "Rain",
                tempCategory: "cold",
            },
        });
        return { id: "weather-1" };
    });
    const recommendationCreate = t.mock.fn(async (args) => {
        assert.equal(args.data.weatherSnapshot, undefined);
        assert.equal(args.data.weatherSnapshotId, "weather-1");
        return { id: "history-1", items: [] };
    });

    const originalRecommendationCreate = prisma.recommendation.create;
    const originalWeatherSnapshotCreate = prisma.weatherSnapshot.create;
    prisma.recommendation.create = recommendationCreate as unknown as typeof prisma.recommendation.create;
    prisma.weatherSnapshot.create = weatherSnapshotCreate as unknown as typeof prisma.weatherSnapshot.create;
    t.after(() => {
        prisma.recommendation.create = originalRecommendationCreate;
        prisma.weatherSnapshot.create = originalWeatherSnapshotCreate;
    });

    await createRecommendationHistory({
        userId: "user-1",
        weatherSnapshot: {
            location: "Boston, MA",
            tempF: 42,
            humidity: 81,
            windSpeed: 12,
            precipitationChance: 0.6,
            uvIndex: 2,
            condition: "Rain",
            tempCategory: "cold",
        },
        inputContext: {},
        output: {},
        generatedAt: createdAt,
        recommendations: [],
    });

    assert.equal(weatherSnapshotCreate.mock.callCount(), 1);
    assert.equal(recommendationCreate.mock.callCount(), 1);
});

test("createRecommendationHistory safely skips weather snapshot creation when weather is unavailable", async (t) => {
    const { createRecommendationHistory } = await import("./recommendationRepository");
    const recommendationCreate = t.mock.fn(async (args) => {
        assert.equal(args.data.weatherSnapshot, undefined);
        assert.equal(args.data.weatherSnapshotId, null);
        return { id: "history-1", items: [] };
    });

    const originalCreate = prisma.recommendation.create;
    prisma.recommendation.create = recommendationCreate as unknown as typeof prisma.recommendation.create;
    t.after(() => {
        prisma.recommendation.create = originalCreate;
    });

    await createRecommendationHistory({
        userId: "user-1",
        weatherSnapshot: null,
        inputContext: {},
        output: {},
        recommendations: [],
    });

    assert.equal(recommendationCreate.mock.callCount(), 1);
});