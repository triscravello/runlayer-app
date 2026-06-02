"use client";

import { Edit3, Trash2 } from "lucide-react";
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
    race_day: "Race day",
    training: "Training",
    custom: "Custom",
};

export function SavedKitCard({ kit, gearItems, onEdit, onDelete }: SavedKitCardProps) {
    return (
        <Card className="border-slate-200 shadow-sm">
            <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle className="text-xl text-slate-950">{kit.name ?? "Saved Kit"}</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">{kit.description || "Reusable gear setup for future runs."}</p>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{typeLabels[kit.type] ?? "Custom"}</Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-2">
                    {gearItems.length ? gearItems.map((gear) => (
                        <div key={gear.id ?? gear.name} className="flex items-center justify-between rounded-xl border bg-slate-50 px-3 py-2 text-sm">
                            <span className="font-medium text-slate-800">{gear.name ?? "Saved gear item"}</span>
                            <span className="text-muted-foreground">{gear.brand?.name ?? gear.category ?? "Gear"}</span>
                        </div>
                    )) : <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No gear items persisted yet.</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={onEdit}><Edit3 className="size-4" /> Edit kit</Button>
                    <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={onDelete}><Trash2 className="size-4" /> Delete</Button>
                </div>
            </CardContent>
        </Card>
    );
}