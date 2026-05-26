"use client";
import { Sparkles, ImagePlus, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export function GearEditor() {
  return (
    <Card className="h-fit rounded-2xl border-zinc-800/80 bg-zinc-900/75 xl:sticky xl:top-24">
      <CardHeader className="border-b border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Gear Editor</CardTitle>
            <p className="mt-1 text-xs text-zinc-400">Edit gear details and metadata.</p>
          </div>
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">Autosave · synced</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <h3 className="text-sm font-medium text-zinc-200">Basic Info</h3>
          <div className="mt-3 space-y-3 text-sm text-zinc-300">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Name</label>
              <Input className="border-zinc-700 bg-zinc-900" defaultValue="AeroDry Performance Tee" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Brand</label>
                <Input className="border-zinc-700 bg-zinc-900" defaultValue="Nike" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Category</label>
                <select className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100">
                  <option>Top</option>
                  <option>Bottom</option>
                  <option>Outerwear</option>
                  <option>Accessory</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Description</label>
              <textarea rows={4} defaultValue="Lightweight technical tee designed for warm-weather runs with moisture-wicking mesh zones." className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100" />
            </div>
          </div>
        </section>

        <details open className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-100">Media</summary>
          <div className="mt-3 space-y-3 text-sm text-zinc-300">
            <div className="grid grid-cols-3 gap-2">
              <div className="aspect-square rounded-lg border border-zinc-700 bg-zinc-900" />
              <div className="aspect-square rounded-lg border border-zinc-700 bg-zinc-900" />
              <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60">
                <ImagePlus className="size-5 text-zinc-500" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="bg-zinc-800 text-zinc-200">Images uploaded</Badge>
              <Button variant="outline" className="border-zinc-700">Upload Image</Button>
            </div>
          </div>
        </details>

        <details open className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-100">Recommendation Metadata</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary" className="bg-zinc-800 text-zinc-200">Activity: Road Running</Badge>
            <Badge variant="secondary" className="bg-zinc-800 text-zinc-200">Weather: Hot / Humid</Badge>
            <Badge variant="secondary" className="bg-zinc-800 text-zinc-200">Intensity: Tempo</Badge>
            <Badge variant="secondary" className="bg-zinc-800 text-zinc-200">Fit: Slim</Badge>
          </div>
        </details>

        <details open className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-100">Weather Conditions</summary>
          <div className="mt-3 grid gap-3 text-sm text-zinc-300 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Temperature Range (°F)</label>
              <div className="flex items-center gap-2">
                <Input defaultValue="62" className="border-zinc-700 bg-zinc-900" />
                <span className="text-zinc-500">to</span>
                <Input defaultValue="88" className="border-zinc-700 bg-zinc-900" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Precipitation Tolerance</label>
              <select className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100">
                <option>Dry only</option>
                <option>Light drizzle</option>
                <option>Rain-ready</option>
              </select>
            </div>
          </div>
        </details>

        <details className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-100">Intensity Compatibility</summary>
          <div className="mt-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
            {["Easy", "Tempo", "Interval", "Race Day"].map((level) => (
              <label key={level} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                <input type="checkbox" className="accent-zinc-200" defaultChecked={level !== "Easy"} />
                {level}
              </label>
            ))}
          </div>
        </details>

        <details open className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-100">Recommendation Explanation Preview</summary>
          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
            <p>
              Optimized for <span className="text-zinc-100">tempo and interval sessions</span> in <span className="text-zinc-100"> warm, humid conditions</span> where rapid moisture and breathable fabric improve comfort.
            </p>
            <Button variant="outline" className="mt-3 border-zinc-700">
              <RefreshCcw className="mr-2 size-3.5" /> Regenerate
            </Button>
          </div>
        </details>

        <section className="rounded-xl border border-zinc-700/80 bg-zinc-950 p-4">
          <h3 className="text-sm font-medium text-zinc-100">Visibility & Publishing</h3>
          <div className="mt-3 space-y-3 text-sm text-zinc-300">
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-amber-500/20 text-amber-300">Draft</Badge>
              <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">Published</Badge>
              <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">Archived</Badge>
            </div>
            <p className="text-xs text-zinc-500">Last updated: May 25, 2026 at 18:05 UTC · by admin@runlayer.io</p>
            <p className="flex items-center gap-2 text-xs text-zinc-300"><Sparkles className="size-3.5" /> Ready for recommendation engine indexing.</p>
          </div>
        </section>
      </CardContent>
      
      <div className="sticky bottom-0 mt-auto flex gap-2 border-t border-zinc-800 bg-zinc-900/95 p-4 backdrop-blur">
        <Button variant="outline" className="border-zinc-700">Save Draft</Button>
        <Button className="flex-1 bg-zinc-100 text-zinc-900 hover:bg-white">Publish Update</Button>
        <Button variant="outline" className="border-zinc-700">Archive</Button>
        <Button variant="destructive">Delete</Button>
      </div>
    </Card>
  );
}