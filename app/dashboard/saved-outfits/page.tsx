"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { useAuth } from "@/context/authContext";
import { useSavedOutfits } from "@/hooks/useSavedOutfits";
import type { SavedKitType, SavedOutfit } from "@/services/savedOutfitService";
import { SavedKitCard } from "@/components/saved/SavedKitCard";
import { SavedKitEditor } from "@/components/saved/SavedKitEditor";

type SavedOutfitGearItem = {
    gearItem?: {
        id?: string;
        name?: string;
        category?: string;
        brand?: { name?: string | null } | null;
    } | null;
};

const kitGroups: Array<{ type: SavedKitType, label: string, description: string }> = [
    { type: "race_day", label: "Race day kits", description: "Pinned setups for goal efforts and events" },
    { type: "training", label: "Training kits", description: "Everyday gear combinations for repeat workouts" },
    { type: "custom", label: "Custom kits", description: "Flexible saved outfits and manual builds" },
]

function getGearItems(outfit: SavedOutfit) {
    const outfitItems = Array.isArray(outfit.OutfitItem) ? outfit.OutfitItem as SavedOutfitGearItem[] : [];
    return outfitItems.flatMap((entry) => entry.gearItem ? [entry.gearItem] : []);
}

function groupKits(outfits: SavedOutfit[]) {
    return kitGroups.map((group) => ({
        ...group,
        kits: outfits.filter((outfit) => (outfit.type ?? "custom") === group.type),
    }));
}

export default function SavedOutfitsPage() {
    const { user, loading: authLoading } = useAuth();
    const { savedOutfits, isLoading, error, successMessage, deleteSavedOutfit, updateSavedOutfit } = useSavedOutfits(user?.id);
    const [editingId, setEditingId] = useState<string | null>(null);
    const groups = groupKits(savedOutfits);

    return (
        <main className="min-h-screen bg-background p-4 md:p-8">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="space-y-2">
                    <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Dashboard</p>
                    <h1 className="text-3xl font-semibold text-slate-950">Saved kits</h1>
                    <p className="max-w-2xl text-muted-foreground">
                        Name, group, edit, and reuse saved gear kits for race day, training, and custom run scenarios.
                    </p>
                </div>

                {!user && !authLoading ? (
                    <Card className="border-dashed border-emerald-200 bg-emerald-50/50 shadow-none">
                        <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
                            Sign in to view saved kits.
                        </CardContent>
                    </Card>
                ) : null}

                {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
                {successMessage ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div> : null}
                {isLoading || authLoading ? <div className="text-sm text-muted-foreground">Loading saved kits…</div> : null}

                {savedOutfits.length ? (
                    <div className="space-y-8 pb-10">
                        {groups.map((group) => group.kits.length ? (
                            <section key={group.type} className="space-y-4">
                                <div>
                                    <h2 className="text-xl font-semibold text-slate-950">{group.label}</h2>
                                    <p className="text-sm text-muted-foreground">{group.description}</p>
                                </div>

                                <div className="grid gap-4">
                                    {group.kits.map((kit) => editingId === kit.id && user ? (
                                        <SavedKitEditor key={kit.id} kit={kit} userId={user.id} onCancel={() => setEditingId(null)} onSave={updateSavedOutfit} />
                                    ) : (
                                        <SavedKitCard
                                            key={kit.id}
                                            kit={kit}
                                            gearItems={getGearItems(kit)}
                                            onEdit={() => setEditingId(kit.id)}
                                            onDelete={() => user ? deleteSavedOutfit({ userId: user.id, outfitId: kit.id }) : undefined}
                                        />
                                    ))}
                                </div>
                            </section>
                        ) : null)}
                    </div>
                ) : !isLoading && user ? (
                    <Card className="border-dashed border-emerald-200 bg-emerald-50/50 shadow-none">
                        <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">No saved kits yet. Save a recommendation as a named kit to reuse it later.</CardContent>
                    </Card>
                ) : null}
            </div>
        </main>
    );
}