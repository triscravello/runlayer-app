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
};

const TOTAL_GEAR_ITEMS = 317;
const FILTER_BY_REDUCTION_BY_KEY: Record<FilterKey, number> = {
    brand: 93,
    category: 58, 
    weather: 41,
    intensity: 34,
    status: 49,
};

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
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<ViewMode>("compact");

    const activeFilters = useMemo(
        () => PRIMARY_FILTERS.filter((filter) => activeFilterKeys.includes(filter.key)),
        [activeFilterKeys],
    );

    const visibleItemCount = useMemo(() => {
        if (!activeFilterKeys.length && !searchQuery.trim()) {
            return TOTAL_GEAR_ITEMS;
        }

        const filterReduction = activeFilterKeys.reduce(
            (count, key) => count + FILTER_BY_REDUCTION_BY_KEY[key],
            0,
        );
        const searchReduction = searchQuery.trim() ? 28 : 0;

        return Math.max(TOTAL_GEAR_ITEMS - filterReduction - searchReduction, 12);
    }, [activeFilterKeys, searchQuery]);

    const toggleFilter = (key: FilterKey) => {
        setActiveFilterKeys((current) => 
            current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
        );
    };

    const removeFilter = (key: FilterKey) => {
        setActiveFilterKeys((current) => current.filter((item) => item !== key));
    };

    const clearFilters = () => {
        setActiveFilterKeys([]);
        setSearchQuery("");
    };

    const hasActiveState = activeFilters.length > 0 || Boolean(searchQuery.trim());

    return (
        <section className="rounded-2xl border border-zinc-800/70 bg-zinc-900/60 p-3 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1 basis-72 lg:max-w-lg">
                        <label className="sr-only" htmlFor="gear-filter-search">
                            Search gear inventory
                        </label>
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
                        <Input
                            id="gear-filter-search"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            className="h-9 border-zinc-700 bg-zinc-950/60 pl-9 pr-3 text-zinc-100 placeholder:text-zinc-500"
                            placeholder="Search gear, tags, terrain, notes..."
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Primary gear filters">
                        {PRIMARY_FILTERS.map((filter) => {
                            const isActive = activeFilterKeys.includes(filter.key);
                            const activeStyles = filter.isWarning ? "border-amber-500/45 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15" : "border-zinc-500 bg-zinc-800/90 text-zinc-100 hover:bg-zinc-800";
                            const inactiveStyles = "border-zinc-700/80 bg-zinc-900/70 text-zinc-400 hover:border-zinc-800/60 hover:text-zinc-200";

                            return (
                                <Button 
                                    key={filter.key}
                                    type="button"
                                    variant="outline"
                                    onClick={() => toggleFilter(filter.key)}
                                    aria-pressed={isActive}
                                    className={[
                                        "h-8 gap-1.5 px-2.5 text-xs focus-visible:ring-zinc-500/60",
                                        isActive ? activeStyles : inactiveStyles,
                                    ].join(" ")}
                                >
                                    <span className={filter.isWarning && isActive ? "text-amber-200/80" : "text-zinc-500"}>{filter.label}</span>
                                    <span className={isActive ? "font-medium" : "text-zinc-300"}>{filter.value}</span>
                                </Button>
                            );
                        })}
                    </div>

                    <div 
                        className="ml-auto flex items-center overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-950/40"
                        role="group"
                        aria-label="Inventory view mode"
                    >
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
                                        "h-8 rounded-none border-0 px-2.5 text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200 focus-visible:ring-zinc-500/60",
                                        isSelected ? "bg-zinc-800 text-zinc-100 shadow-inner hover:bg-zinc-800 hover:text-zinc-100" : "",
                                    ].join(" ")}
                                    aria-pressed={isSelected}
                                >
                                    <Icon className="size-4" aria-hidden="true" />
                                    <span className="sr-only md:not-sr-only md:ml-1.5">{option.label}</span>
                                </Button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-800/70 pt-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 text-zinc-300">
                            <Filter className="size-3" aria-hidden="true" />
                            Active filters
                        </Badge>

                        {activeFilters.length ? (
                            activeFilters.map((filter) => {
                                const chipStyles = filter.isWarning ? "border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 focus-visible:ring-amber-500/40" : "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 focus-visible:ring-zinc-500/60";
                                const labelStyles = filter.isWarning ? "text-amber-200/80" : "text-zinc-400";

                                return (
                                    <button
                                        key={filter.key}
                                        type="button"
                                        onClick={() => removeFilter(filter.key)}
                                        className={[
                                            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors outline-none focus-visible:ring-[3px]",
                                            chipStyles
                                        ].join(" ")}
                                        aria-label={`Remove ${filter.label} filter: ${filter.value}`}
                                    >
                                        <span className={labelStyles}>{filter.label}</span>
                                        <span className="font-medium">{filter.value}</span>
                                        <X className="size-3.5 opacity-75" aria-hidden="true" />
                                    </button>
                                );
                            })
                        ) : (
                            <span className="text-xs text-zinc-500">No active filters</span>
                        )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span>
                            {hasActiveState ? `Showing ${visibleItemCount} of ${TOTAL_GEAR_ITEMS} items` : `${TOTAL_GEAR_ITEMS} total items`}
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:ring-zinc-500/60"
                        >
                            Sort: Last Updated
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:ring-zinc-500/60"
                            onClick={clearFilters}
                            disabled={!hasActiveState}
                        >
                            <RotateCcw className="size-4" aria-hidden="true" />
                            Clear
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:ring-zinc-500/60"
                        >
                            <Save className="size-4" aria-hidden="true" />
                            Save preset
                        </Button>
                    </div>
                </div>
            </div>
        </section>
    );
}