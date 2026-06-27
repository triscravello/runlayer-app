"use client";

import Link from "next/link";
import { Edit3, RotateCcw, Scale, Trash2 } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import type { SavedOutfit } from "@/services/savedOutfitService";

export type SavedKitCardProps = {
    kit: SavedOutfit,
    gearItems: Array<{ id?: string; name?: string; category?: string; brand?: { name?: string | null } | null }>;
    onEdit: () => void;
    onDelete: () => void;
}

const typeLabels: Record<string, string> = {
    "race-day": "Race day",
    race_day: "Race day",
    intervals: "Intervals",
    "long-run": "Long run",
    trail: "Trail",
    rain: "Rain",
    "cold-weather": "Cold weather",
    summer: "Summer",
    favorites: "Favorites",
    training: "Training",
    custom: "Custom",
};

function groupGearItems(gearItems: SavedKitCardProps["gearItems"]) {
    return gearItems.reduce<Record<string, SavedKitCardProps["gearItems"]>>((groups, item) => {
        const category = item.category ?? "Gear";
        groups[category] = [...(groups[category] ?? []), item];
        return groups;
    }, {});
}

function formatDate(date: SavedOutfit["createdAt"]) {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(date));
}

export function SavedKitCard({ kit, gearItems, onEdit, onDelete }: SavedKitCardProps) {
    const groupedGearItems = groupGearItems(gearItems);
    const compareHref = `/compare?gear=${gearItems.flatMap((item) => item.id ? [item.id] : []).join(",")}`;

    return (
        <Card className="border-slate-200 shadow-sm">
            <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle className="text-xl text-slate-950">{kit.name ?? "Saved Kit"}</CardTitle>
                        {kit.description ? <p className="mt-1 text-sm text-muted-foreground">{kit.description}</p> : null}
                        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">Saved {formatDate(kit.createdAt)}</p>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{typeLabels[kit.type] ?? "Favorites"}</Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {gearItems.length ? (
                    <div className="grid gap-3">
                        {Object.entries(groupedGearItems).map(([category, items]) => (
                            <div key={category} className="rounded-2xl border bg-slate-50 p-3">
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{category}</h3>

                                <div className="grid gap-2">
                                    {items.map((gear) => (
                                        <div key={gear.id ?? gear.name} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm">
                                            <span className="font-medium text-slate-800">{gear.name ?? "Saved gear item"}</span>
                                            <span className="text-muted-foreground">{gear.brand?.name ?? "RunLayer"}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No gear items persisted yet.</p>}
                <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline"><Link href="/recommendation"><RotateCcw className="size-4" /> Use Again</Link></Button>
                    <Button asChild variant="outline" disabled={gearItems.length < 2}><Link href={compareHref}><Scale className="size-4" /> Compare</Link></Button>
                    <Button variant="outline" onClick={onEdit}><Edit3 className="size-4" /> Edit</Button>
                    <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={onDelete}><Trash2 className="size-4" /> Delete</Button>
                </div>
            </CardContent>
        </Card>
    );
}