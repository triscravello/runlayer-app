"use client";

import { MoreHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type GearTableItem = { id: string; name: string; category: string; priceRange: string; brandId?: string; updatedAt?: Date };

const statuses = ["Ready", "Missing Metadata", "Needs Scoring", "Hidden"] as const;

export function GearTable({ items }: { items: GearTableItem[] }) {
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm">
        <span className="text-zinc-400">0 selected</span>
        <div className="flex flex-wrap gap-2">{["Publish", "Hide", "Delete", "Re-score", "Export"].map((a) => <Button key={a} size="sm" variant="outline" className="border-zinc-700 bg-zinc-900">{a}</Button>)}</div>
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-zinc-950 text-zinc-400">
              <tr>{["", "Image", "Name", "Brand", "Category", "Price", "Weather", "Intensity", "Rec. Score", "Status", "Last Updated", "Actions"].map((h) => <th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {items.length === 0 ? <tr><td colSpan={12} className="px-6 py-16 text-center text-zinc-500">No gear found. Try adjusting filters or importing a new catalog.</td></tr> : items.map((item, i) => {
                const status = statuses[i % statuses.length];
                return <tr key={item.id} className="border-t border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-800/40">
                  <td className="px-3 py-3"><input type="checkbox" className="rounded border-zinc-700 bg-zinc-900" /></td>
                  <td className="px-3 py-3"><div className="size-9 rounded-md bg-gradient-to-br from-zinc-700 to-zinc-900" /></td>
                  <td className="px-3 py-3 font-medium text-zinc-100">{item.name}</td>
                  <td className="px-3 py-3 text-zinc-300">{item.brandId ?? "Unknown"}</td>
                  <td className="px-3 py-3 text-zinc-300">{item.category}</td>
                  <td className="px-3 py-3 text-zinc-300">{item.priceRange}</td>
                  <td className="px-3 py-3 text-zinc-300">Cold, Rain</td>
                  <td className="px-3 py-3 text-zinc-300">Moderate</td>
                  <td className="px-3 py-3 text-zinc-100">{(65 + (i % 20)).toString()}</td>
                  <td className="px-3 py-3"><Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-200">{status}</Badge></td>
                  <td className="px-3 py-3 text-zinc-400">2h ago</td>
                  <td className="px-3 py-3"><Button size="icon" variant="ghost"><MoreHorizontal className="size-4" /></Button></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex items-center justify-between text-sm text-zinc-400"><span>Showing {items.length} items • infinite-scroll ready</span><div className="flex gap-2"><Button size="sm" variant="outline" className="border-zinc-700">Previous</Button><Button size="sm" variant="outline" className="border-zinc-700">Next</Button></div></div>
    </div>
  );
}