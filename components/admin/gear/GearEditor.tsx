"use client";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export function GearEditor() {
    return (
    <Card className="h-fit rounded-2xl border-zinc-800/80 bg-zinc-900/75 xl:sticky xl:top-24">
      <CardHeader className="border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <CardTitle>Gear Editor</CardTitle>
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">Autosave · synced</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {[
          "Basic Info", "Media", "Recommendation Metadata", "Weather Conditions", "Intensity Compatibility", "Recommendation Explanation Preview", "Visibility & Publishing", "AI Analysis",
        ].map((section) => (
          <details key={section} open className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <summary className="cursor-pointer list-none text-sm font-medium text-zinc-200">{section}</summary>
            <div className="mt-3 grid gap-2 text-sm text-zinc-300">
              <Input className="border-zinc-700 bg-zinc-900" placeholder={`Update ${section.toLowerCase()}...`} />
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="bg-zinc-800">Tag</Badge>
                <Badge variant="secondary" className="bg-zinc-800">Condition</Badge>
                <Badge variant="secondary" className="bg-zinc-800">Score</Badge>
              </div>
            </div>
          </details>
        ))}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">
          <p className="mb-2 flex items-center gap-2 font-medium"><Sparkles className="size-4 text-zinc-400" /> AI suggestions</p>
          <p>Consider adding terrain compatibility metadata and confidence explanation for weather transitions.</p>
        </div>
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