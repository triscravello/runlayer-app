"use client";

import { useMemo, useState } from "react";
import { MoreHorizontal, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import Image from "next/image";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export type GearStatus = "Ready" | "Missing Metadata" | "Needs Scoring" | "Hidden";

export type GearTableItem = {
  id: string;
  name: string;
  category?: string;
  priceRange?: string;
  brandId?: string;
  status?: GearStatus;
  recommendationScore?: number;
  weatherTags?: string[];
  intensity?: string;
  updatedAt?: Date;
  imageUrl?: string | null;
};

type SortKey = "recommendationScore" | "updatedAt" | "status";
type SortDirection = "asc" | "desc";

type SortState = { key: SortKey; direction: SortDirection };
type GearTableProps = { items: GearTableItem[]; onSelectItem?: (itemId: string) => void  };

const statusStyle: Record<GearStatus, string> = {
  Ready: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  "Missing Metadata": "border-amber-500/30 bg-amber-500/10 text-amber-200",
  "Needs Scoring": "border-sky-500/30 bg-sky-500/10 text-sky-200",
  Hidden: "border-zinc-600 bg-zinc-800 text-zinc-200",
};

const statusOrder: Record<GearStatus, number> = {
  Ready: 0,
  "Needs Scoring": 1,
  "Missing Metadata": 2,
  Hidden: 3,
}

function StatusBadge({ status }: { status?: GearStatus }) {
  if (!status) return <EmptyStateCell message="No status" />;
  return <Badge variant="outline" className={statusStyle[status]}>{status}</Badge>
}

function EmptyStateCell({ message }: { message: string }) {
  return <span className="text-zinc-500">{message}</span>
}

function getScoreColor(score: number) {
  if (score >= 80) return "bg-emerald-400";
  if (score >= 60) return "bg-sky-400";
  if (score >= 40) return "bg-amber-400";
  return "bg-rose-400";
}

function ScoreCell({ score }: { score?: number }) {
  if (typeof score !== "number") return <EmptyStateCell message="No score" />;
  const clampedScore = Math.max(0, Math.min(score, 100));
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
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

function formatRelativeDate(updatedAt?: Date) {
  if (!updatedAt) return null;
  const diff = Date.now() - updatedAt.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("");
}

export function GearTable({ items, onSelectItem }: GearTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<SortState>({ key: "updatedAt", direction: "desc" });

  const sortedItems = useMemo(() => {
    const cloned = [...items];
    cloned.sort((a, b) => {
      const directionMultiplier = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "recommendationScore") {
        return ((a.recommendationScore ?? -1) - (b.recommendationScore ?? -1)) * directionMultiplier;
      }
      if (sort.key === "updatedAt") {
        return ((a.updatedAt?.getTime() ?? 0) - (b.updatedAt?.getTime() ?? 0)) * directionMultiplier;
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
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm">
        {hasSelected ? (
          <>
            <span className="text-zinc-200">{selectedIds.size} selected</span>
            <div className="flex flex-wrap gap-2">{["Publish", "Hide", "Delete", "Re-score", "Export"].map((action) => <Button key={action} size="sm" variant="outline" className="border-zinc-700 bg-zinc-900">{action}</Button>)}</div>
          </>
        ) : (
          <span className="text-zinc-400">Select rows to enable bulk actions.</span>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 text-zinc-400 backdrop-blur">
              <tr>
                <th className="px-3 py-3 font-medium">
                  <span className="sr-only">Select row</span>
                </th>
                <th className="px-3 py-3 font-medium">Image</th>
                <th className="px-3 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Brand</th>
                <th className="px-3 py-3 font-medium">Category</th>
                <th className="px-3 py-3 font-medium">Price</th>
                <th className="px-3 py-3 font-medium">Weather</th>
                <th className="px-3 py-3 font-medium">Intensity</th>
                <th className="px-3 py-3 font-medium"><SortableHeader label="Rec. Score" sortKey="recommendationScore" sort={sort} onSort={toggleSort} /></th>
                <th className="px-3 py-3 font-medium"><SortableHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} /></th>
                <th className="px-3 py-3 font-medium"><SortableHeader label="Last Updated" sortKey="updatedAt" sort={sort} onSort={toggleSort} /></th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-6 py-16 text-center text-zinc-500">No gear found. Try adjusting filters or importing a new catalog.</td>
                </tr>
              ) : (
                sortedItems.map((item) => {
                  const selected = selectedIds.has(item.id);
                  const hasValidImageUrl = typeof item.imageUrl === "string" && item.imageUrl.trim().length > 0;
                  return (
                    <tr key={item.id} className={`border-t border-zinc-800/60 bg-zinc-900/40 transition-colors ${selected ? "bg-zinc-800/70" : "hover:bg-zinc-800/50"}`}>
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
                      <td className="px-3 py-3">
                        {hasValidImageUrl ? (
                          <Image src={item.imageUrl ?? ""} alt={item.name} width={36} height={36} className="size-9 rounded-md object-cover" />
                        ) : (
                          <div className="flex size-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-[10px] font-semibold text-zinc-300">
                            {getInitials(item.name)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <button 
                          type="button" 
                          className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectItem?.(item.id);
                          }}
                        >
                          <p className="font-semibold text-zinc-500">{item.name}</p>
                          <p className="text-xs text-zinc-500">ID: {item.id}</p>
                        </button>
                      </td>
                      <td className="px-3 py-3 text-zinc-300">{item.brandId ?? <EmptyStateCell message="No brand" />}</td>
                      <td className="px-3 py-3 text-zinc-300">{item.category ?? <EmptyStateCell message="No category" />}</td>
                      <td className="px-3 py-3 text-zinc-300">{item.priceRange ?? <EmptyStateCell message="No price" />}</td>
                      <td className="px-3 py-3 text-zinc-300">{item.weatherTags?.length ? item.weatherTags.join(", ") : <EmptyStateCell message="No weather tags" />}</td>
                      <td className="px-3 py-3 text-zinc-300">{item.intensity ?? <EmptyStateCell message="No intensity" />}</td>
                      <td className="px-3 py-3"><ScoreCell score={item.recommendationScore} /></td>
                      <td className="px-3 py-3"><StatusBadge status={item.status} /></td>
                      <td className="px-3 py-3 text-zinc-400">{formatRelativeDate(item.updatedAt) ?? <EmptyStateCell message="Never updated" />}</td>
                      <td className="px-3 py-3">
                        <Button size="icon" variant="ghost" className="text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-sky-500">
                          <MoreHorizontal className="size-4" />
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
      <p className="text-sm text-zinc-400">Showing {sortedItems.length} items • infinite scroll enabled</p>
    </div>
  );
}