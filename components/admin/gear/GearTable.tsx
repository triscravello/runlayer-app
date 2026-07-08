"use client";

import { useMemo, useState } from "react";
import { Pencil, ChevronDown, ChevronUp, ChevronsUpDown, Columns3 } from "lucide-react";
import Image from "next/image";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { toTimestamp, type SerializableDate } from "@/lib/utils/date";

export type GearStatus = "Ready" | "Missing Metadata" | "Needs Scoring" | "Hidden";

export type GearTableItem = {
  id: string;
  name: string;
  category?: string;
  priceRange?: string;
  genderTarget?: string | null;
  brandId?: string;
  brand?: { name?: string | null } | null;
  status?: GearStatus;
  recommendationScore?: number;
  weatherTags?: string[];
  intensity?: string;
  updatedAt?: SerializableDate;
  imageUrl?: string | null;
};

type SortKey = "recommendationScore" | "updatedAt" | "status";
type SortDirection = "asc" | "desc";

type SortState = { key: SortKey; direction: SortDirection };
type GearTableProps = { items: GearTableItem[]; onSelectItem?: (itemId: string) => void  };

const statusStyle: Record<GearStatus, string> = {
  Ready: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
  "Missing Metadata": "border-amber-500/30 bg-amber-500/10 text-amber-200",
  "Needs Scoring": "border-sky-500/25 bg-sky-500/10 text-sky-200",
  Hidden: "border-zinc-700 bg-zinc-800/70 text-zinc-300",
};

const statusOrder: Record<GearStatus, number> = {
  Ready: 0,
  "Needs Scoring": 1,
  "Missing Metadata": 2,
  Hidden: 3,
}

function StatusBadge({ status }: { status?: GearStatus }) {
  if (!status) return <EmptyStateCell message="Pending" />;
  return <Badge variant="outline" className={statusStyle[status]}>{status}</Badge>
}

function EmptyStateCell({ message = "Missing" }: { message?: string }) {
  return <Badge variant="outline" className="whitespace-nowrap border-zinc-700/80 bg-zinc-900/70 text-[11px] font-medium text-zinc-400">{message}</Badge>
}

function getScoreColor(score: number) {
  if (score >= 80) return "bg-emerald-400";
  if (score >= 60) return "bg-sky-400";
  if (score >= 40) return "bg-amber-400";
  return "bg-rose-400";
}

function ScoreCell({ score }: { score?: number }) {
  if (typeof score !== "number") return <EmptyStateCell message="Pending" />;
  const clampedScore = Math.max(0, Math.min(score, 100));
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full ${getScoreColor(clampedScore)}`} style={{ width: `${clampedScore}%` }} />
      </div>
      <p className="text-xs font-semibold text-zinc-200">{clampedScore}</p>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const isActive = sort.key === sortKey;
  const Icon = !isActive ? ChevronsUpDown : sort.direction === "asc" ? ChevronUp : ChevronDown;

  return (
    <Button 
      variant="ghost"
      size="sm"
      onClick={() => onSort(sortKey)}
      className="h-auto p-0 text-zinc-400 hover:bg-transparent hover:text-zinc-200"
      aria-label={`Sort by ${label}`}
      aria-sort={isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      <Icon className="size-3.5 ml-1" />
    </Button>
  );
}

function formatRelativeDate(updatedAt?: SerializableDate) {
  const timestamp = toTimestamp(updatedAt);
  if (!timestamp) return null;
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatGenderTarget(value?: string | null) {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "MEN") return "Men";
  if (normalized === "WOMEN") return "Women";
  if (normalized === "UNISEX") return "Unisex";
  return null;
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("");
}

export function GearTable({ items, onSelectItem }: GearTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<SortState>({ key: "updatedAt", direction: "desc" });
  const [isCompact, setIsCompact] = useState(false);

  const sortedItems = useMemo(() => {
    const cloned = [...items];
    cloned.sort((a, b) => {
      const directionMultiplier = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "recommendationScore") {
        return ((a.recommendationScore ?? -1) - (b.recommendationScore ?? -1)) * directionMultiplier;
      }
      if (sort.key === "updatedAt") {
        return (toTimestamp(a.updatedAt) - toTimestamp(b.updatedAt)) * directionMultiplier;
      }
      return ((statusOrder[a.status ?? "Hidden"] - statusOrder[b.status ?? "Hidden"]) * directionMultiplier);
    });
    return cloned;
  }, [items, sort]);

  const hasSelected = selectedIds.size > 0;

  const toggleSelection = (itemId: string, shouldSelect?: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const select = typeof shouldSelect === "boolean" ? shouldSelect : !next.has(itemId);
      if (select) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "desc" };
    });
  }

  return (
    <div className="min-w-0 space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/45 px-3 py-2 text-sm">
        <span className="text-zinc-400">
          {hasSelected ? `${selectedIds.size} selected. Bulk actions are not enabled yet.` : "Select rows for future bulk actions, or click a product name to edit it."}
        </span>
        <Button type="button" size="sm" variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-200" onChange={() => setIsCompact((current) => !current)} aria-pressed={isCompact}>
          <Columns3 className="size-4" /> {isCompact ? "Comfort columns" : "Compact columns"}
        </Button>
      </div>
      <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-800/80">
        <div className="max-h-[560px] overflow-auto">
          <table className={`w-full table-fixed text-left text-sm ${isCompact ? "min-w-[840px]" : "min-w-[1120px]"}`}>
            <thead className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 text-zinc-400 backdrop-blur">
              <tr>
                <th className="w-10 px-3 py-3 font-medium">
                  <span className="sr-only">Select row</span>
                </th>
                {!isCompact ? <th className="w-16 px-3 py-3 font-medium">Image</th> : null}
                <th className={isCompact ? "w-[32%] px-3 py-3 font-medium" : "w-[24%] px-3 py-3 font-medium"}>Name</th>
                <th className={isCompact ? "w-[18%] px-3 py-3 font-medium" : "w-[14%] px-3 py-3 font-medium"}>Brand</th>
                <th className="w-[11%] px-3 py-3 font-medium">Category</th>
                <th className="w-[10%] px-3 py-3 font-medium">Price</th>
                <th className="w-[10%] px-3 py-3 font-medium">Gender</th>
                {!isCompact ? <th className="w-[14%] px-3 py-3 font-medium">Weather</th> : null}
                {!isCompact ? <th className="w-[10%] px-3 py-3 font-medium">Fit</th> : null}
                {!isCompact ? <th className="px-3 py-3 font-medium"><SortableHeader label="Rec. Score" sortKey="recommendationScore" sort={sort} onSort={toggleSort} /></th> : null}
                <th className="px-3 py-3 font-medium"><SortableHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} /></th>
                <th className="px-3 py-3 font-medium"><SortableHeader label="Last Updated" sortKey="updatedAt" sort={sort} onSort={toggleSort} /></th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={isCompact ? 9 : 13} className="px-6 py-16 text-center text-zinc-500">No gear found. Try adjusting filters or importing a new catalog.</td>
                </tr>
              ) : (
                sortedItems.map((item) => {
                  const selected = selectedIds.has(item.id);
                  const hasValidImageUrl = typeof item.imageUrl === "string" && item.imageUrl.trim().length > 0;
                  return (
                    <tr key={item.id} className={`border-t border-zinc-800/60 bg-zinc-900/25 transition-colors ${selected ? "bg-zinc-800/70" : "hover:bg-zinc-800/40"}`}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.name}`}
                          checked={selected}
                          onChange={(event) => {
                            toggleSelection(item.id, event.target.checked);
                          }}
                          onClick={(event) => event.stopPropagation()}
                          className="rounded border-zinc-700 bg-zinc-900 accent-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        />
                      </td>
                      {!isCompact ? (
                        <td className="px-3 py-3">
                          {hasValidImageUrl ? (
                            <Image src={item.imageUrl ?? ""} alt={item.name} width={36} height={36} className="size-9 rounded-md object-cover" />
                          ) : (
                            <div className="flex size-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-[10px] font-semibold text-zinc-300">
                              {getInitials(item.name)}
                            </div>
                          )}
                        </td>
                      ) : null}
                      <td className="px-3 py-3">
                        <button 
                          type="button" 
                          className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectItem?.(item.id);
                          }}
                        >
                          <p className="truncate font-semibold text-zinc-100">{item.name}</p>
                          <p className="truncate text-xs text-zinc-500">{item.imageUrl ? "Image configured" : "Missing image"} • ID: {item.id}</p>
                        </button>
                      </td>
                      <td className="truncate px-3 py-3 text-zinc-300">{item.brand?.name ?? item.brandId ?? <EmptyStateCell />}</td>
                      <td className="truncate px-3 py-3 text-zinc-300">{item.category ?? <EmptyStateCell />}</td>
                      <td className="truncate px-3 py-3 text-zinc-300">{item.priceRange ?? <EmptyStateCell />}</td>
                      <td className="truncate px-3 py-3 text-zinc-300">{formatGenderTarget(item.genderTarget) ?? <EmptyStateCell />}</td>
                      {!isCompact ? <td className="px-3 py-3 text-zinc-300"><span className="line-clamp-2">{item.weatherTags?.length ? item.weatherTags.join(", ") : <EmptyStateCell message="Needs metadata" />}</span></td> : null}
                      {!isCompact ? <td className="truncate px-3 py-3 text-zinc-300">{item.intensity ?? <EmptyStateCell />}</td> : null}
                      {!isCompact ? <td className="px-3 py-3"><ScoreCell score={item.recommendationScore} /></td> : null}
                      <td className="px-3 py-3"><StatusBadge status={item.status} /></td>
                      <td className="whitespace-nowrap px-3 py-3 text-zinc-400">{formatRelativeDate(item.updatedAt) ?? <EmptyStateCell message="Pending" />}</td>
                      <td className="px-3 py-3">
                        <Button type="button" size="sm" variant="ghost" className="text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-sky-500" onClick={() => onSelectItem?.(item.id)}>
                          <Pencil className="size-4" /> Edit
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-sm text-zinc-400">Showing {sortedItems.length} items in {isCompact ? "compact" : "comfort"} table mode.</p>
    </div>
  );
}