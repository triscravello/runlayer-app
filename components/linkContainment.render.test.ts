import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Renders the real components that show shopping links, fed with legacy/hostile stored values the way each one receives
// them in production, and asserts that no unsafe link becomes an active <a href>. Fake Prisma only; no database.
const SAFE = "https://example.com/buy";
const UNSAFE = ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "ftp://example.com/x", "//evil.example/x", "https://user:pw@example.com/x"];

const stored = (id: string, affiliateUrl: string | null, variants: Array<Record<string, unknown>>) => ({
    id, name: `Item ${id}`, brandId: "b1", genderTarget: null, category: "TOP", subcategory: null, priceRange: "MID", tags: [], bodyTypeFit: [],
    imageUrl: null, affiliateUrl, weatherHot: 0.5, weatherCold: 0.5, weatherRain: 0.5, weatherWind: 0.5,
    createdAt: new Date(0), updatedAt: new Date(0), brand: { id: "b1", name: "Acme" }, variants,
});
const variant = (label: string, affiliateUrl: string | null) => ({ id: `v-${label}`, label, gender: "unisex", affiliateUrl, imageUrl: null, price: null, sizes: [] });

const rows = [
    ...UNSAFE.map((url, index) => stored(`bad-${index}`, null, [variant("Default", url)])),
    stored("bad-item-level", "javascript:alert(1)", []),
    stored("good", null, [variant("Default", SAFE)]),
];
(globalThis as unknown as { prisma: unknown }).prisma = { gearItem: { findMany: async () => rows } };

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));
const externalHrefs = (html: string) => hrefs(html).filter((href) => !href.startsWith("/"));

test("SavedKitCard (client-side selection over raw API data): only the safe link becomes a shopping link", async () => {
    const { SavedKitCard } = await import("./saved/SavedKitCard");
    const gearItems = rows.map((row) => ({ id: row.id, name: row.name, category: "TOP", genderTarget: null, affiliateUrl: row.affiliateUrl, imageUrl: null, variants: row.variants as never, brand: row.brand }));
    const kit = { id: "k1", userId: "u1", recommendationId: null, name: "Kit", description: null, type: "favorites", isFavorite: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    const html = renderToStaticMarkup(createElement(SavedKitCard, { kit: kit as never, gearItems, onEdit: () => {}, onDelete: () => {} }));

    assert.deepEqual(externalHrefs(html), [SAFE]);
    assert.equal(html.match(/javascript:|data:text|vbscript:|file:|ftp:|evil\.example|user:pw/), null);
});

test("GearComparisonTable fed by the real candidate mapping: only the safe link becomes a shopping link", async () => {
    const { listGearRecommendationCandidates } = await import("@/lib/db/gearRepository");
    const { GearComparisonTable } = await import("./compare/GearComparisonTable");
    const candidates = await listGearRecommendationCandidates();
    const items = candidates.map((item) => ({ item, score: 1, reasons: [], totalScore: 1, scoreBreakdown: { weather: 1, intensity: 1, terrain: 1, seasonality: 1, budget: 1, brandAffinity: 0, brandPenalty: 0, temperatureTolerance: 1 } }));
    const html = renderToStaticMarkup(createElement(GearComparisonTable, { items: items as never }));

    assert.deepEqual(externalHrefs(html), [SAFE]);
    assert.equal(html.match(/javascript:|data:text|vbscript:|file:|ftp:|evil\.example|user:pw/), null);
});

test("a recommendation-style payload (server-mapped candidates serialized as JSON) carries no unsafe link", async () => {
    const { listGearRecommendationCandidates } = await import("@/lib/db/gearRepository");
    const json = JSON.stringify(await listGearRecommendationCandidates());
    assert.equal(json.match(/javascript:|data:text|vbscript:|file:|ftp:|evil\.example|user:pw/), null);
    assert.ok(json.includes(SAFE));
});
