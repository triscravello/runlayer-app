"use client"

import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import type { RecommendationGearItem } from "@/lib/engine/types/recommendationEngine";

export type GearSelectorProps = {
    gearItems: RecommendationGearItem[];
    selectedIds: string[];
    onSelectionChange: (ids: string[]) => void;
};

export function GearSelector({ gearItems, selectedIds, onSelectionChange }: GearSelectorProps) {
    function toggleItem(itemId: string) {
        if (selectedIds.includes(itemId)) {
            onSelectionChange(selectedIds.filter((id) => id !== itemId));
            return;
        }

        if (selectedIds.length < 4) onSelectionChange([...selectedIds, itemId]);
    }

    return (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {gearItems.map((item) => {
                const selected = selectedIds.includes(item.id);
                const disabled = !selected && selectedIds.length >= 4;

                return (
                    <Button
                        key={item.id}
                        type="button"
                        variant="outline"
                        onClick={() => toggleItem(item.id)}
                        disabled={disabled}
                        className="h-auto justify-start rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-50 data-[selected=true]:border-emerald-500 data-[selected=true]:bg-emerald-50"
                        data-selected={selected}
                    >
                        <span className="block-w-full">
                            <span className="flex items-start justify-between gap-3">
                                <span>
                                    <span className="block font-semibold text-slate-950">{item.name}</span>
                                    <span className="block text-sm text-muted-foreground">{item.brandName ?? item.brandId ?? "Brand unknown"}</span>
                                </span>
                                {selected ? <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Selected</Badge> : null}
                            </span>
                            <span className="mt-3 flex flex-wrap gap-1.5">
                                {[item.category, item.priceRange, ...item.tags.slice(0, 3)].filter(Boolean).map((tag) => (
                                    <Badge key={tag} variant="outline" className="bg-white/80 capitalize">{tag}</Badge>
                                ))}
                            </span>
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}