"use client";

import { useMemo } from "react";
import { RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { GearBrandOption, GearEditorItem } from "./GearEditor";

export type GearFilterState = {
  searchQuery: string;
  category: "all" | GearEditorItem["category"];
  priceRange: "all" | GearEditorItem["priceRange"];
  brandId: "all" | string;
  imageStatus: "all" | "with-image" | "missing-image";
  metadataStatus: "all" | "complete" | "needs-metadata";
}

type GearFiltersProps = {
  filters: GearFilterState;
  items: GearEditorItem[];
  brands: GearBrandOption[];
  resultCount: number;
  onFiltersChange: (filters: GearFilterState) => void;
}

const categoryOptions: GearFilterState["category"][] = ["all", "TOP", "BOTTOM", "ACCESSORY"];
const priceRangeOptions: GearFilterState["priceRange"][] = ["all", "BUDGET", "MID", "PREMIUM"];

const emptyFilters: GearFilterState = {
  searchQuery: "",
  category: "all",
  priceRange: "all",
  brandId: "all",
  imageStatus: "all",
  metadataStatus: "all",
}

export function GearFilters({ filters, items, brands, resultCount, onFiltersChange }: GearFiltersProps) {
  const updateFilters = (next: Partial<GearFilterState>) => onFiltersChange({ ...filters, ...next });
  const brandOptions = useMemo(() => {
    const options = new Map(brands.map((brand) => [brand.id, brand.name]));
    for (const item of items) {
      if (!options.has(item.brandId)) options.set(item.brandId, item.brand?.name ?? item.brandId);
    }
    return [...options.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [brands, items]);
  const hasActiveState = filters.searchQuery.trim() || filters.category !== "all" || filters.priceRange !== "all" || filters.brandId !== "all" || filters.imageStatus !== "all" || filters.metadataStatus !== "all";

  return (
    <section className="rounded-2xl border border-zinc-800/70 bg-zinc-900/60 p-3 shadow-sm backdrop-blur">
      <div className="grid gap-3 xl:grid-cols-[minmax(280px,1fr)_auto] xl:items-center">
        <div className="relative min-w-0">
          <label className="sr-only" htmlFor="gear-filter-search">Search gear catalog</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
          <Input
            id="gear-filter-search"
            value={filters.searchQuery}
            onChange={(event) => updateFilters({ searchQuery: event.target.value })}
            className="h-9 border-zinc-700 bg-zinc-950/60 pl-9 pr-3 text-zinc-100 placeholder:text-zinc-500"
            placeholder="Search names, brands, tags, subcategory, or body fit..."
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 xl:flex xl:flex-wrap xl:justify-end">
          <select value={filters.category} onChange={(event) => updateFilters({ category: event.target.value as GearFilterState["category"] })} className="h-9 min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100">
            {categoryOptions.map((category) => <option key={category} value={category}>{category === "all" ? "All categories" : category}</option>)}
          </select>
          <select value={filters.priceRange} onChange={(event) => updateFilters({ priceRange: event.target.value as GearFilterState["priceRange"] })} className="h-9 min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100">
            {priceRangeOptions.map((priceRange) => <option key={priceRange} value={priceRange}>{priceRange === "all" ? "All prices" : priceRange}</option>)}
          </select>
          <select value={filters.brandId} onChange={(event) => updateFilters({ brandId: event.target.value })} className="h-9 min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100">
            <option value="all">All brands</option>
            {brandOptions.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
          <select value={filters.imageStatus} onChange={(event) => updateFilters({ imageStatus: event.target.value as GearFilterState["imageStatus"] })} className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100">
            <option value="all">All image states</option>
            <option value="with-image">Has image</option>
            <option value="missing-image">Missing image</option>
          </select>
          <select value={filters.metadataStatus} onChange={(event) => updateFilters({ metadataStatus: event.target.value as GearFilterState["metadataStatus"] })} className="h-9 min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100">
            <option value="all">All metadata</option>
            <option value="complete">Metadata complete</option>
            <option value="needs-metadata">Needs metadata</option>
          </select>
        </div>
      </div>
      
      <div className="mt-3 flex flex-col gap-2 border-t border-zinc-800/70 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-zinc-400">
          Showing {resultCount.toLocaleString()} of {items.length.toLocaleString()} catalog items. Filters are local to this page.
        </p>
        <Button type="button" size="sm" variant="ghost" className="h-8 w-fit text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" onClick={() => onFiltersChange(emptyFilters)} disabled={!hasActiveState}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Clear filters
        </Button>
      </div>
    </section>
  );
}