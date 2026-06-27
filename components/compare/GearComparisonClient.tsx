"use client"

import { useMemo, useState } from "react";
import { GearComparisonTable } from "./GearComparisonTable";
import { GearSelector } from "./GearSelector";
import type { ScoredRecommendationItem } from "@/lib/engine/types/recommendationEngine";

export function GearComparisonClient({ scoredItems, initialSelectedIds = [] }: { scoredItems: ScoredRecommendationItem[]; initialSelectedIds?: string[] }) {
    const [selectedIds, setSelectedIds] = useState(() => {
        const availableIds = new Set(scoredItems.map(({ item }) => item.id));
        const requestedIds = initialSelectedIds.filter((id) => availableIds.has(id)).slice(0, 4);
        return requestedIds.length ? requestedIds : scoredItems.slice(0, 3).map(({ item }) => item.id);
    });
    const selectedItems = useMemo(() => scoredItems.filter(({ item }) => selectedIds.includes(item.id)), [scoredItems, selectedIds]);

    return (
        <div className="space-y-6">
            <div className="rounded-3-xl border bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-slate-950">Choose 2-4 gear items</h2>
                        <p className="text-sm text-muted-foreground">Comparison scores come from the recommendation engine.</p>
                    </div>
                    <div className="text-sm font-medium text-emerald-700">{selectedIds.length}/4 selected</div>
                </div>
                <GearSelector gearItems={scoredItems.map(({ item }) => item)} selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
            </div>
            <GearComparisonTable items={selectedItems} />
        </div>
    );
}