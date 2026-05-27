"use client";
import { useMemo, useState } from "react";
import { Filter, RotateCcw, Save, Search, LayoutGrid, List, Table, X } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type FilterKey = "brand" | "category" | "weather" | "intensity" | "status";
type ViewMode = "grid" | "compact" | "table";

type FilterDefinition = {
    key: FilterKey;
    label: string;
    value: string;
    isWarning?: boolean;
}

const PRIMARY_FILTERS: FilterDefinition[] = [
    { key: "brand", label: "Brand", value: "Nike" },
    { key: "category", label: "Category", value: "Top" },
    { key: "weather", label: "Weather", value: "Cold" },
    { key: "intensity", label: "Intensity", value: "High Output" },
    { key: "status", label: "Status", value: "Missing Metadata", isWarning: true },
];

const VIEW_OPTIONS: Array<{ key: ViewMode; label: string; icon: typeof LayoutGrid }> = [
    { key: "grid", label: "Grid", icon: LayoutGrid },
    { key: "compact", label: "Compact", icon: List },
    { key: "table", label: "Table", icon: Table },
];

export function GearFilters() {
    const [activeFilterKeys, setActiveFilterKeys] = useState<FilterKey[]>(["brand", "category", "weather", "status"]);
    const [viewMode, setViewMode] = useState<ViewMode>("compact");

    const activeFilters = useMemo(
        () => PRIMARY_FILTERS.filter((filter) => activeFilterKeys.includes(filter.key)),
        [activeFilterKeys],
    );

    const removeFilter = (key: FilterKey) => {
        setActiveFilterKeys((current) => current.filter((item) => item !== key));
    }

    const clearFilters = () => {
        setActiveFilterKeys([]);
    }

    return (
        <section className="sticky top-24 z-20 rounded-2xl border border-zinc-800/80 bg-zinc-900/75 p-4 shadow-lg backdrop-blur-xl">
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-500" />
                    <Input className="border-zinc-700 bg-zinc-950/70 pl-9 text-zinc-100" placeholder="Search gear ID, tags, terrain, notes, metadata..." />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {PRIMARY_FILTERS.map((filter) => {
                        const isActive = activeFilterKeys.includes(filter.key);
                        const warningStyles = isActive && filter.isWarning ? "border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20" : "";
                        
                        return (
                            <Button 
                                key={filter.key}
                                variant="outline" 
                                className={[
                                    "h-9 border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800",
                                    isActive ? "border-zinc-500 bg-zinc-800/80 text-zinc-100" : "text-zinc-400",
                                    warningStyles
                                ].join(" ")}
                            >
                                <span className="text-zinc-400">{filter.label}</span>
                                <span className="ml-1 text-zinc-100">{filter.value}</span>
                            </Button>
                        );
                    })}

                    <Button 
                        variant="outline"
                        className="h-9 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                    >
                        Sort: Last Updated
                    </Button>
                </div>

                <div className="ml-auto flex items-center overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/90">
                    {VIEW_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const isSelected = viewMode === option.key;

                        return (
                            <Button
                                key={option.key}
                                type="button"
                                variant="ghost"
                                onClick={() => setViewMode(option.key)}
                                className={[
                                    "h-9 rounded-none border-0 px-3 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                                    isSelected ? "bg-zinc-800 text-zinc-100" : "",
                                ].join(" ")}
                                aria-pressed={isSelected}
                            >
                                <Icon className="size-4" />
                                <span className="sr-only md:not-sr-only md:ml-1">{option.label}</span>
                            </Button>
                        );
                    })}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-3">
                <Badge variant="outline" className="border-zinc-700 bg-zinc-800/60 text-zinc-200">
                    <Filter className="mr-1 size-3" />
                    Active filters
                </Badge>

                <div className="flex flex-1 flex-wrap items-center gap-1.5">
                    {activeFilters.length ? (
                        activeFilters.map((filter) => (
                            <button
                                key={filter.key}
                                type="button"
                                onClick={() => removeFilter(filter.key)}
                                className={[
                                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                                    filter.isWarning ? "border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20" : "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700",
                                ].join(" ")}
                            >
                                <span className="text-zinc-300">{filter.label}:</span>
                                <span>{filter.value}</span>
                                <X className="size-3.5" aria-hidden="true" />
                                <span className="sr-only">Remove {filter.label} filter</span>
                            </button>
                        ))
                    ) : (
                        <span className="text-xs text-zinc-500">No active filters</span>
                    )}
                </div>

                <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
                    <span>Showing 42 of 317 items</span>
                    <span className="text-zinc-600">•</span>
                    <span>Updated 3m ago</span>
                </div>

                <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="text-zinc-300" onClick={clearFilters}>
                        <RotateCcw className="size-4" />
                        Clear
                    </Button>
                    <Button size="sm" variant="ghost" className="text-zinc-300">
                        <Save className="size-4" />
                        Save Preset
                    </Button>
                </div>
            </div>
        </section>
    );
}