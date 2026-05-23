"use client";
import { Filter, RotateCcw, Save, Search, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const chips = ["Brand: Arc'teryx", "Category: Top", "Weather: Cold", "Status: Missing Metadata"];

export function GearFilters() {
    return (
        <section className="sticky top-24 z-20 rounded-2xl border border-zinc-800/80 bg-zinc-900/75 p-4 shadow-lg backdrop-blur-xl">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-64 flex-1">
                    <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-500" />
                    <Input className="border-zinc-700 bg-zinc-950/70 pl-9 text-zinc-100" placeholder="Search gear, tags, descriptions, brand..." />
                </div>
                {['Brand', 'Category', 'Weather', 'Intensity', 'Status', 'Sort'].map((f) => (
                    <Button key={f} variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">{f}</Button>
                ))}
                <Button variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-200"><SlidersHorizontal className="size-4" /> Compact</Button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-zinc-700 bg-zinc-800/60 text-zinc-200"><Filter className="mr-1 size-3" /> Active filters</Badge>
                {chips.map((chip) => <Badge key={chip} variant="secondary" className="bg-zinc-800 text-zinc-200">{chip}</Badge>)}
                <Button size="sm" variant="ghost" className="text-zinc-300"><RotateCcw className="size-4" />Clear</Button> 
                <Button size="sm" variant="ghost" className="text-zinc-300"><Save className="size-4" />Save Preset</Button>
            </div>
        </section>
    );
}