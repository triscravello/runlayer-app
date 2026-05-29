"use client";

import { Trash2 } from "lucide-react";

import { SavedOutfitsList, type SavedOutfitListItem } from "@/components/saved/SavedOutfitsList";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { useAuth } from "@/context/authContext";
import { useSavedOutfits } from "@/hooks/useSavedOutfits";
import type { SavedOutfit } from "@/services/savedOutfitService";

type SavedRecommendation = {
    output?: unknown;
    inputContext?: unknown;
    weatherSnapshot?: unknown;
};

type SavedOutfitGearItem = {
    gearItem?: {
        id?: string;
        name?: string;
        category?: string;
        subcategory?: string | null;
        tags?: string[];
        brand?: { name?: string | null } | null;
    } | null;
}

type RecommendationOutput = {
    outfits?: Array<{
        score?: number;
        explanation?: string[];
        items?: {
            top?: { id?: string, name?: string; category? : string; tags?: string[]; brand?: { name: string | null } | null };
            bottom?: { id?: string, name?: string; category? : string; tags?: string[]; brand?: { name: string | null } | null };
            accessories?: { id?: string, name?: string; category? : string; tags?: string[]; brand?: { name: string | null } | null };
        }
    }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function asRecommendation(value: unknown): SavedRecommendation | null {
    return isRecord(value) ? value : null;
}

function asOutput(value: unknown): RecommendationOutput {
    return isRecord(value) ? value : {};
}

function getString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getWeatherTags(recommendation: SavedRecommendation | null) {
    const weather = isRecord(recommendation?.inputContext) ? recommendation?.inputContext : isRecord(recommendation?.weatherSnapshot) ? recommendation?.weatherSnapshot : null;

    const temp = getNumber(weather?.temperature) ?? getNumber(weather?.tempF);
    const condition = getString(weather?.condition);
    const precipitationChance = getNumber(weather?.precipitationChance);

    return [
        temp === undefined ? undefined : { label: `${Math.round(temp)}°F`, tone: "weather" as const },
        condition ? { label: condition, tone: "weather" as const } : undefined,
        precipitationChance === undefined ? undefined : { label: `${Math.round(precipitationChance * 100)}% rain`, tone: "weather as const" },
    ].filter(Boolean) as SavedOutfitListItem["weatherTags"];
}

function mapGearItem(item: NonNullable<RecommendationOutput["outfits"]>[number]["items"] extends infer T ? T : never, fallbackId: string) {
    if (!isRecord(item)) {
        return [];
    }

    return Object.entries(item).flatMap(([slot, rawValue]) => {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];

        return values.filter(isRecord).map((gear, index) => ({
            id: getString(gear.id) ?? `${fallbackId}-${slot}-${index}`,
            label: getString(gear.name) ?? "Saved gear item",
            category: slot === "accessories" ? "Accessories" : slot,
            description: getString(isRecord(gear.brand) ? gear.brand.name : undefined) ?? getString(gear.category),
            attributes: Array.isArray(gear.tags) ? gear.tags.filter((tag: unknown): tag is string => typeof tag === "string").slice(0, 3) : [],
            group: slot === "accessories" ? "Accessories" : undefined,
        }));
    });
}

function mapOutfitItems(outfit: SavedOutfit) {
    const outfitItems = Array.isArray(outfit.OutfitItem) ? outfit.OutfitItem as SavedOutfitGearItem[] : [];

    return outfitItems.flatMap((entry, index) => {
        const gear = entry.gearItem;

        if (!gear) {
            return [];
        }

        return [{
            id: gear.id ?? `${outfit.id}-gear-${index}`,
            label: gear.name ?? "Saved gear item",
            category: gear.category ?? "Gear",
            description: gear.brand?.name ?? gear.subcategory ?? undefined,
            attributes: gear.tags?.slice(0, 3) ?? [],
        }];
    });
}

function toSavedListItem(outfit: SavedOutfit): SavedOutfitListItem {
    const recommendation = asRecommendation(outfit.recommendation);
    const output = asOutput(recommendation?.output);
    const firstGeneratedOutfit = output.outfits?.[0];
    const generatedItems = mapGearItem(firstGeneratedOutfit?.items, outfit.id);
    const persistedItems = mapOutfitItems(outfit);
    const items = persistedItems.length ? persistedItems : generatedItems;
    const explanation = firstGeneratedOutfit?.explanation?.filter(Boolean) ?? [];
    const score = firstGeneratedOutfit?.score;

    return {
        id: outfit.id,
        title: outfit.name ?? "Saved Outfit",
        savedAt: outfit.createdAt,
        tags: [
            outfit.isFavorite ? { label: "Favorite", tone: "attribute" as const } : undefined,
            typeof score === "number" ? { label: `${Math.round(score)} score`, tone: "attribute" as const } : undefined,
        ].filter(Boolean) as SavedOutfitListItem["tags"],
        weatherTags: getWeatherTags(recommendation),
        workoutTags: [],
        items,
        attributes: [
            { label: "Items", value: `${items.length}` },
            outfit.recommendationId ? { label: "Source", value: "Recommendation" } : { label: "Source", value: "Manual save" },
        ],
        quickReason: explanation[0] ?? "Saved for reuse from a previous recommendation.",
        why: explanation.length ? explanation.slice(0, 3) : undefined,
    };
}

export default function SavedOutfitsPage() {
    const { user, loading: authLoading } = useAuth();
    const {
        savedOutfits,
        isLoading,
        error,
        successMessage,
        deleteSavedOutfit,
    } = useSavedOutfits(user?.id);

    const outfits = savedOutfits.map(toSavedListItem);

    return (
        <main className="min-h-screen bg-background p-4 md:p-8">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="space-y-2">
                    <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Dashboard</p>
                    <h1 className="text-3xl font-semibold text-slate-950">Saved outfits</h1>
                    <p className="max-w-2xl text-muted-foreground">
                        Review saved recommendations, including the weather context and explanation that made each outfit worth keeping.
                    </p>
                </div>

                {!user && !authLoading ? (
                    <Card className="border-dashed border-emerald-200 bg-emerald-50/50 shadow-none">
                        <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
                            Sign in to view saved outfits.
                        </CardContent>
                    </Card>
                ) : null}

                {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
                {successMessage ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div> : null}
                {isLoading || authLoading ? <div className="text-sm text-muted-foreground">Loading saved outfits…</div> : null}

                <SavedOutfitsList
                    outfits={outfits}
                    subtitle="Saved gear setups with weather snapshots and recommendation reasoning."
                    className="pb-10"
                />

                {outfits.length ? (
                    <section className="space-y-3" aria-label="Delete saved outfits">
                        <h2 className="text-lg font-semibold text-slate-950">Manage saved outfits</h2>
                        <div className="grid gap-2">
                            {outfits.map((outfit) => (
                                <div key={outfit.id} className="flex items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3">
                                    <div>
                                        <div className="font-medium text-slate-950">{outfit.title}</div>
                                        <div className="text-sm text-muted-foreground">Delete this saved recommendation from your library.</div>
                                    </div>
                                    <Button
                                        variant="outline"
                                        className="border-red-200 text-red-700 hover:bg-red-50"
                                        onClick={() => user ? deleteSavedOutfit({ userId: user.id, outfitId: outfit.id }) : undefined}
                                    >
                                        <Trash2 className="size-4" /> Delete
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </section>
                ) : null}
            </div>
        </main>
    );
}