"use client";

import { RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { GearEditorItem } from "./GearEditor";

export type GearFilterState = {
    searchQuery: string;
    category: "all" | GearEditorItem["category"];
    imageStatus: "all" | "with-image" | "missing-image";
    metadataStatus: "all" | "complete" | "needs-metadata";
}

type GearFiltersProps = {
    filters: GearFilterState;
    items: GearEditorItem[];
    resultCount: number;
    onFiltersChange: (filters: GearFilterState) => void;
}

const categoryOptions: GearFilterState["category"][] = ["all", "TOP", "BOTTOM", "ACCESSORY"];

export function GearFilters({ filters, items, resultCount, onFiltersChange }: GearFiltersProps) {
  const updateFilters = (next: Partial<GearFilterState>) => onFiltersChange({ ...filters, ...next });
  const hasActiveState = filters.searchQuery.trim() || filters.category !== "all" || filters.imageStatus !== "all" || filters.metadataStatus !== "all";

  return (
    <section className="rounded-2xl border border-zinc-800/70 bg-zinc-900/60 p-3 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1 lg:max-w-xl">
          <label className="sr-only" htmlFor="gear-filter-search">Search gear catalog</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
          <Input
            id="gear-filter-search"
            value={filters.searchQuery}
            onChange={(event) => updateFilters({ searchQuery: event.target.value })}
            className="h-9 border-zinc-700 bg-zinc-950/60 pl-9 pr-3 text-zinc-100 placeholder:text-zinc-500"
            placeholder="Search names, brands, tags, body fit..."
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={filters.category} onChange={(event) => updateFilters({ category: event.target.value as GearFilterState["category"] })} className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100">
            {categoryOptions.map((category) => <option key={category} value={category}>{category === "all" ? "All categories" : category}</option>)}
          </select>
          <select value={filters.imageStatus} onChange={(event) => updateFilters({ imageStatus: event.target.value as GearFilterState["imageStatus"] })} className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100">
            <option value="all">All image states</option>
            <option value="with-image">Image URL configured</option>
            <option value="missing-image">Missing image URL</option>
          </select>
          <select value={filters.metadataStatus} onChange={(event) => updateFilters({ metadataStatus: event.target.value as GearFilterState["metadataStatus"] })} className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100">
            <option value="all">All metadata states</option>
            <option value="complete">Metadata complete</option>
            <option value="needs-metadata">Needs metadata</option>
          </select>
          <Button type="button" size="sm" variant="ghost" className="h-9 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" onClick={() => onFiltersChange({ searchQuery: "", category: "all", imageStatus: "all", metadataStatus: "all" })} disabled={!hasActiveState}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Clear
          </Button>
        </div>
      </div>
      <p className="mt-3 border-t border-zinc-800/70 pt-2 text-xs text-zinc-400">
        Showing {resultCount.toLocaleString()} of {items.length.toLocaleString()} catalog items from current data.
      </p>
    </section>
  );
}