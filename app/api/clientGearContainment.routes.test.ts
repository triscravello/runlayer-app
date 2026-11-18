import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { NextRequest } from "next/server";

// Client-facing gear containment (Stage 2B-D2-B): the internal gear `version` counter must not appear in any client-facing response that
// carries gear objects, through the REAL withAuth/withAdmin -> session chain, routes, services and repositories. Only the edges are
// faked: persistence (a recording fake Prisma, no database) and the request cookie store. Redis and the rate limiter have no backend
// under the test isolation guard (the cache is a no-op, the limiter is in-memory), so nothing is cached between tests.
//
// Fixtures carry `version` and an unexpected `internalNote` at the item, brand and variant level and are DEEP-FROZEN: a route, service or
// mapper that modified a shared object in place would throw. `version` here is ALWAYS the gear row counter; the recommendation engine's
// own `engineVersion` / versionMetadata.version are different things and are asserted to survive.
process.env.BETTER_AUTH_SECRET = "test-only-secret-not-used-anywhere-else-0123456789";

function deepFreeze<T>(value: T): T {
    if (value && typeof value === "object" && !(value instanceof Date)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
}
const date = new Date("2026-01-01T00:00:00.000Z");
// `hostileNested` adds `version`/`internalNote` to the brand and variants too. A real Brand or variant row has no such column, so it is used
// only where the response is rebuilt from an allow-list (outfits, history), which must drop them at every level.
const gear = (id: string, category: string, extra: Record<string, unknown> = {}, hostileNested = true) => ({
    id, name: `${category} ${id}`, brandId: "b1", genderTarget: null, category, subcategory: null, priceRange: "MID", tags: ["light", "breathable"], bodyTypeFit: [],
    weatherHot: 0.9, weatherCold: 0.1, weatherRain: 0.3, weatherWind: 0.3, imageUrl: null, affiliateUrl: "javascript:legacy", createdAt: date, updatedAt: date,
    version: 7, internalNote: "item-secret",
    brand: { id: "b1", name: "Acme", normalizedName: "acme", tier: null, style: null, createdAt: date, updatedAt: date, ...(hostileNested ? { version: 3, internalNote: "brand-secret" } : {}) },
    variants: [
        { id: `${id}-v1`, gearItemId: id, label: "Men", gender: "men", affiliateUrl: "https://shop.example.com/m", imageUrl: null, price: 20, sizes: ["M"], createdAt: date, updatedAt: date, ...(hostileNested ? { version: 9, internalNote: "variant-secret" } : {}) },
        { id: `${id}-v2`, gearItemId: id, label: "Women", gender: "women", affiliateUrl: "data:text/html,x", imageUrl: null, price: null, sizes: [], createdAt: date, updatedAt: date },
    ],
    ...extra,
});
const CATALOG = deepFreeze(["TOP", "BOTTOM", "ACCESSORY"].flatMap((category, index) => [
    gear(`g${index}a`, category, { name: `Alpha ${category}` }, false),
    gear(`g${index}b`, category, { name: `Beta ${category}`, brandId: "b2", brand: { id: "b2", name: "Zed", normalizedName: "zed", tier: null, style: null, createdAt: date, updatedAt: date } }, false),
]));

const hasKey = (value: unknown, key: string): boolean => Array.isArray(value) ? value.some((entry) => hasKey(entry, key)) : value instanceof Date ? false : typeof value === "object" && value !== null ? Object.entries(value).some(([name, entry]) => name === key || hasKey(entry, key)) : false;

// --- Outfit and history fixtures (raw Prisma-shaped rows, as the repositories return them) ----------------------------------------
const outfitRow = () => deepFreeze({
    id: "o1", userId: "u1", recommendationId: null, name: "Kit", description: null, type: "favorites", isFavorite: false, createdAt: date, updatedAt: date,
    recommendation: null,
    OutfitItem: [
        { id: "oi2", outfitId: "o1", gearItemId: "g1a", category: "BOTTOM", gearItem: gear("g1a", "BOTTOM") },
        { id: "oi1", outfitId: "o1", gearItemId: "g0a", category: "TOP", gearItem: gear("g0a", "TOP", { affiliateUrl: "https://shop.example.com/safe" }) },
    ],
});
const historyRows = () => deepFreeze([
    { id: "r1", userId: "u1", generatedAt: date, engineVersion: "1.0.0", algorithmVersion: "1.0.0", topScore: 0.9, weatherSnapshot: null, items: [
        { id: "ri2", recommendationId: "r1", gearItemId: "g1a", rank: 2, totalScore: 0.5, breakdown: { w: 1 }, gearItem: { ...gear("g1a", "BOTTOM"), variants: undefined }, feedback: [{ feedbackType: "LIKE" }] },
        { id: "ri1", recommendationId: "r1", gearItemId: "g0a", rank: 1, totalScore: 0.9, breakdown: null, gearItem: { ...gear("g0a", "TOP", { affiliateUrl: "https://shop.example.com/safe" }), variants: undefined }, feedback: [] },
    ] },
]);

// --- Fake Prisma -----------------------------------------------------------------------------------------------------------------
const state: { role: "ADMIN" | "USER"; cookie: string | undefined; calls: string[] } = { role: "USER", cookie: undefined, calls: [] };
const record = <T,>(name: string, value: () => T) => async () => { state.calls.push(name); return value(); };
const tx = {
    $queryRaw: record("tx.lock", () => [{ id: "o1" }]),
    recommendation: { findFirst: record("tx.recommendation.findFirst", () => ({ id: "r1" })) },
    gearItem: { findMany: record("tx.gearItem.findMany", () => [{ id: "g0a", category: "TOP" }]) },
    savedOutfit: {
        create: record("tx.savedOutfit.create", () => ({ id: "o1" })),
        findFirst: record("tx.savedOutfit.findFirst", () => outfitRow()),
        updateMany: record("tx.savedOutfit.updateMany", () => ({ count: 1 })),
    },
    outfitItem: { deleteMany: record("tx.outfitItem.deleteMany", () => ({ count: 0 })), createMany: record("tx.outfitItem.createMany", () => ({ count: 1 })) },
};
(globalThis as unknown as { prisma: unknown }).prisma = {
    user: { findUnique: async () => ({ id: "u1", email: "a@example.test", role: state.role, sessionVersion: 1, createdAt: date, updatedAt: date, profile: null }) },
    userProfile: { findUnique: record("userProfile.findUnique", () => null) },
    gearItem: { findMany: record("gearItem.findMany", () => CATALOG) },
    weatherSnapshot: { create: record("weatherSnapshot.create", () => ({ id: "w1" })) },
    recommendation: {
        create: async (args: { data: { items: { create: Array<{ gearItemId: string }> } } }) => {
            state.calls.push("recommendation.create");
            return { id: "r1", engineVersion: "1.0.0", generatedAt: date, items: args.data.items.create.map((item, index) => ({ id: `ri${index}`, gearItemId: item.gearItemId })) };
        },
        findMany: record("recommendation.findMany", () => historyRows()),
    },
    savedOutfit: {
        findMany: record("savedOutfit.findMany", () => [outfitRow()]),
        findFirst: record("savedOutfit.findFirst", () => outfitRow()),
    },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => { state.calls.push("$transaction"); return fn(tx); },
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
mock.method(require("next/headers"), "cookies", async () => ({ get: (name: string) => (name === "runlayer_session" && state.cookie ? { name, value: state.cookie } : undefined) }));

async function call(handler: (request: NextRequest, context: never) => Promise<Response> | Response, method: string, path: string, { body, signedIn = true, role = "USER" as "ADMIN" | "USER", params }: { body?: string; signedIn?: boolean; role?: "ADMIN" | "USER"; params?: Record<string, string> } = {}) {
    const { createSessionToken } = await import("@/lib/auth/crypto");
    state.role = role;
    state.cookie = signedIn ? createSessionToken("u1", 1) : undefined;
    state.calls.length = 0;
    const request = new NextRequest(`http://localhost${path}`, { method, body, headers: { "content-type": "application/json" } });
    const response = await handler(request, { params: Promise.resolve(params ?? {}) } as never);
    return { status: response.status, body: await response.json() as unknown, calls: [...state.calls] };
}

// ---------------------------------------------------------------------------------------------------------------------------------
test("POST /api/recommend: no gear version anywhere in the response (recommendations, recommendedOutfit, alternatives, alternativesByCategory); every other field is intact", async () => {
    const { POST } = await import("@/app/api/recommend/route");
    const response = await call(POST as never, "POST", "/api/recommend", { body: '{"weather":"hot","intensity":"tempo","terrain":"road","category":"all"}' });
    assert.equal(response.status, 200);
    const body = response.body as Record<string, unknown> & { recommendations: Array<{ item: Record<string, unknown> }>; recommendedOutfit: Record<string, { item: Record<string, unknown> } | undefined>; alternatives: Array<{ item: Record<string, unknown> }>; alternativesByCategory: Record<string, Array<{ item: Record<string, unknown> }>> };

    // The four places a gear object appears, all non-empty so the check is meaningful.
    assert.ok(body.recommendations.length > 0 && Object.values(body.recommendedOutfit).some(Boolean) && body.alternatives.length > 0 && Object.values(body.alternativesByCategory).some((list) => list.length > 0), "the fixture exercises every nested branch");
    assert.equal(hasKey(body.recommendations, "version"), false, "recommendations[].item");
    assert.equal(hasKey(body.recommendedOutfit, "version"), false, "recommendedOutfit.*.item");
    assert.equal(hasKey(body.alternatives, "version"), false, "alternatives[].item");
    assert.equal(hasKey(body.alternativesByCategory, "version"), false, "alternativesByCategory.*[].item");
    assert.equal(hasKey(body, "version"), false);

    // Existing envelope and fields: unchanged apart from the omitted counter. (The mapper OMITS `version`; it is not an allow-list, so
    // other columns, here the unexpected `internalNote`, are deliberately still passed through exactly as before.)
    assert.deepEqual(Object.keys(body).sort(), ["alternatives", "alternativesByCategory", "engineVersion", "generatedAt", "historyId", "recommendationId", "recommendedOutfit", "recommendations"].sort());
    assert.equal(body.engineVersion, "1.0.0", "the engine's own version string is a different thing and is untouched");
    const item = body.recommendations[0].item;
    for (const field of ["id", "name", "brandId", "category", "tags", "weatherSuitability", "selectedVariant", "brandName", "variants", "brand", "createdAt", "updatedAt", "internalNote"]) assert.ok(field in item, `item.${field} is still present`);
    assert.equal(item.affiliateUrl, null, "affiliate containment is unchanged");
    assert.deepEqual((item.variants as Array<{ affiliateUrl: unknown }>).map((variant) => variant.affiliateUrl), ["https://shop.example.com/m", null]);
    assert.equal(CATALOG[0].version, 7, "the shared fixture rows were not modified (they are frozen)");
});

test("compare page: the candidate data passed to the browser carries no gear version and keeps its fields", async () => {
    const { default: ComparePage } = await import("../../app/(app)/compare/page");
    const { GearComparisonClient } = await import("@/components/compare/GearComparisonClient");
    const tree = await ComparePage({ searchParams: Promise.resolve({ gear: "g0a" }) });
    const find = (node: unknown): { props: { scoredItems: Array<{ item: Record<string, unknown> }>; initialSelectedIds: string[] } } | null => {
        if (Array.isArray(node)) { for (const child of node) { const hit = find(child); if (hit) return hit; } return null; }
        if (typeof node !== "object" || node === null) return null;
        const element = node as { type?: unknown; props?: { children?: unknown } };
        if (element.type === GearComparisonClient) return element as never;
        return find(element.props?.children);
    };
    const client = find(tree);
    assert.ok(client, "the page renders GearComparisonClient");
    assert.ok(client.props.scoredItems.length > 0);
    assert.equal(hasKey(client.props.scoredItems, "version"), false, "no gear version in the serialized props");
    assert.deepEqual(client.props.initialSelectedIds, ["g0a"], "the page's own inputs are unchanged");
    assert.equal(client.props.scoredItems[0].item.id, "g0a", "selected items are still ranked first");
    for (const field of ["name", "category", "brandName", "selectedVariant", "weatherSuitability"]) assert.ok(field in client.props.scoredItems[0].item, field);
});

test("saved outfit routes: list, detail, create and update return the same envelope with contained gear and no version", async () => {
    const list = await import("@/app/api/outfit/save/route");
    const detail = await import("@/app/api/outfit/[id]/route");
    const expectOutfit = (body: unknown) => {
        const outfit = body as ReturnType<typeof outfitRow> & { OutfitItem: Array<{ id: string; gearItem: Record<string, unknown> & { brand: Record<string, unknown>; variants: Array<Record<string, unknown>> } }> };
        assert.equal(hasKey(outfit.OutfitItem, "version"), false, "no gear version in OutfitItem[].gearItem (item, brand, variants)");
        assert.equal(JSON.stringify(outfit).includes("secret"), false, "no unlisted column");
        assert.deepEqual(outfit.OutfitItem.map((entry) => entry.id), ["oi2", "oi1"], "OutfitItem order is preserved");
        assert.deepEqual({ id: outfit.id, userId: outfit.userId, name: outfit.name, type: outfit.type, isFavorite: outfit.isFavorite, recommendation: outfit.recommendation }, { id: "o1", userId: "u1", name: "Kit", type: "favorites", isFavorite: false, recommendation: null }, "the parent envelope is unchanged");
        const first = outfit.OutfitItem[0].gearItem;
        assert.equal(first.affiliateUrl, null, "an unsafe item link is contained");
        assert.equal(outfit.OutfitItem[1].gearItem.affiliateUrl, "https://shop.example.com/safe", "a safe item link is returned unchanged");
        assert.deepEqual(first.variants.map((variant) => variant.affiliateUrl), ["https://shop.example.com/m", null]);
        assert.equal(first.brand.name, "Acme");
        assert.equal(first.weatherHot, 0.9);
    };

    const listed = await call(list.GET as never, "GET", "/api/outfit/save");
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(listed.body) && (listed.body as unknown[]).length === 1);
    expectOutfit((listed.body as unknown[])[0]);

    const got = await call(detail.GET as never, "GET", "/api/outfit/o1", { params: { id: "o1" } });
    assert.equal(got.status, 200);
    expectOutfit(got.body);

    const created = await call(list.POST as never, "POST", "/api/outfit/save", { body: '{"name":"Kit","type":"favorites","gearItemIds":["g0a"]}' });
    assert.equal(created.status, 201);
    expectOutfit(created.body);

    const updated = await call(detail.PUT as never, "PUT", "/api/outfit/o1", { body: '{"name":"Renamed"}', params: { id: "o1" } });
    assert.equal(updated.status, 200);
    expectOutfit(updated.body);
});

test("recommendation history: GET /api/recommendation, /api/recommendation/history and the plural alias all return contained gear and the same envelope", async () => {
    const singular = await import("@/app/api/recommendation/history/route");
    const plural = await import("@/app/api/recommendations/history/route");
    const root = await import("@/app/api/recommendation/route");
    assert.equal(plural.GET, singular.GET, "the plural route is a re-export of the same handler");

    for (const [handler, path] of [[singular.GET, "/api/recommendation/history"], [plural.GET, "/api/recommendations/history"], [root.GET, "/api/recommendation"]] as const) {
        const response = await call(handler as never, "GET", path);
        assert.equal(response.status, 200, path);
        const records = response.body as Array<{ id: string; engineVersion: string; items: Array<{ id: string; rank: number; totalScore: number; breakdown: unknown; feedback: unknown[]; gearItem: Record<string, unknown> & { brand: Record<string, unknown> } }> }>;
        assert.equal(records.length, 1, path);
        assert.equal(hasKey(records[0].items, "version"), false, `${path}: no gear version in items[].gearItem`);
        assert.equal(JSON.stringify(records).includes("secret"), false, `${path}: no unlisted column`);
        assert.equal(records[0].engineVersion, "1.0.0", "the record's own engine version is a different thing and is preserved");
        assert.deepEqual(records[0].items.map((item) => [item.id, item.rank, item.totalScore, item.breakdown, item.feedback]), [["ri1", 1, 0.9, null, []], ["ri2", 2, 0.5, { w: 1 }, [{ feedbackType: "LIKE" }]]], `${path}: items stay sorted by rank with their own fields`);
        assert.equal(records[0].items[0].gearItem.affiliateUrl, "https://shop.example.com/safe", `${path}: a safe link is unchanged`);
        assert.equal(records[0].items[1].gearItem.affiliateUrl, null, `${path}: an unsafe link is contained`);
        assert.equal(records[0].items[0].gearItem.brand.name, "Acme");
        assert.equal("variants" in records[0].items[0].gearItem, false, `${path}: a gear object that had no variants still has none`);
    }
});

test("admin catalog GET still returns each gear row's version (the editor needs it)", async () => {
    const { GET } = await import("@/app/api/admin/gear/route");
    const response = await call(GET as never, "GET", "/api/admin/gear", { role: "ADMIN" });
    assert.equal(response.status, 200);
    const rows = response.body as Array<{ id: string; version: number }>;
    assert.equal(rows.length, CATALOG.length);
    assert.deepEqual(rows.map((row) => row.version), CATALOG.map(() => 7), "the admin response keeps version, intentionally");
});

test("authentication and authorization are unchanged: without a session every route is 401 and nothing is read; the admin catalog needs ADMIN", async () => {
    const recommend = await import("@/app/api/recommend/route");
    const outfits = await import("@/app/api/outfit/save/route");
    const outfit = await import("@/app/api/outfit/[id]/route");
    const history = await import("@/app/api/recommendation/history/route");
    const plural = await import("@/app/api/recommendations/history/route");
    const root = await import("@/app/api/recommendation/route");
    const admin = await import("@/app/api/admin/gear/route");

    const attempts: Array<[string, (request: NextRequest, context: never) => Promise<Response> | Response, string, string, string?]> = [
        ["POST recommend", recommend.POST as never, "POST", "/api/recommend", '{"weather":"hot"}'],
        ["GET outfits", outfits.GET as never, "GET", "/api/outfit/save"],
        ["POST outfits", outfits.POST as never, "POST", "/api/outfit/save", '{"gearItemIds":["g0a"]}'],
        ["GET outfit", outfit.GET as never, "GET", "/api/outfit/o1"],
        ["PUT outfit", outfit.PUT as never, "PUT", "/api/outfit/o1", '{"name":"x"}'],
        ["GET history", history.GET as never, "GET", "/api/recommendation/history"],
        ["GET history alias", plural.GET as never, "GET", "/api/recommendations/history"],
        ["GET recommendation", root.GET as never, "GET", "/api/recommendation"],
    ];
    for (const [label, handler, method, path, body] of attempts) {
        const response = await call(handler, method, path, { signedIn: false, body, params: { id: "o1" } });
        assert.equal(response.status, 401, label);
        assert.deepEqual(response.calls, [], `${label}: nothing was read or written`);
        assert.equal(JSON.stringify(response.body).includes("version"), false, label);
    }
    const notAdmin = await call(admin.GET as never, "GET", "/api/admin/gear", { role: "USER" });
    assert.equal(notAdmin.status, 403);
    assert.deepEqual(notAdmin.calls, [], "the admin catalog was not read for a non-admin");
});

test("compare page authorization is unchanged: the authenticated layout still redirects an unauthenticated visitor", async () => {
    const { default: Layout } = await import("../../app/(app)/layout");
    state.cookie = undefined;
    await assert.rejects(Layout({ children: null }), (error: unknown) => String((error as { digest?: unknown }).digest ?? "").includes("NEXT_REDIRECT"));
});

test("dormant recommendation branches are contained too: the owner-less result of generateGearRecommendations and generateOutfitRecommendations", async () => {
    const { generateGearRecommendations } = await import("@/services/recommendationServerService");
    const { generateOutfitRecommendations } = await import("@/lib/engine/recommendationEngine");
    state.calls.length = 0;

    // No owner: nothing is persisted and the ranked items are returned directly (a branch /api/recommend never takes today).
    const anonymous = await generateGearRecommendations({ weather: "hot", intensity: "tempo", terrain: "road", category: "all" } as never, 5, null);
    assert.ok(anonymous.recommendations.length > 0);
    assert.equal(hasKey(anonymous, "version"), false, "owner-less branch: no gear version in recommendations, recommendedOutfit, alternatives or alternativesByCategory");
    assert.equal(state.calls.includes("recommendation.create"), false, "and it persisted nothing");
    assert.equal(anonymous.engineVersion, "1.0.0", "the engine version string is untouched");

    // The engine helper that loads the same candidates (it has no caller today).
    const outfits = await generateOutfitRecommendations({ weather: "hot", intensity: "tempo", terrain: "road", category: "all" } as never);
    assert.ok(outfits.recommendations.length > 0);
    assert.equal(hasKey(outfits, "version"), false);
});
