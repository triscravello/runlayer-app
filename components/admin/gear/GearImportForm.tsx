"use client";

import { AlertTriangle, CheckCircle2, DatabaseZap, RefreshCw, UploadCloud } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

export function GearImportForm() {
  return (
    <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="size-5 text-zinc-400" />Import Workflow</CardTitle>
          <CardDescription>JSON / CSV ingestion wizard with validation pipeline, duplicate detection, and category mapping preview.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/60 p-8 text-center">
            <UploadCloud className="mx-auto mb-2 size-6 text-zinc-500" />
            <p className="text-sm text-zinc-300">Drag and drop file here, or browse</p>
            <p className="mt-1 text-xs text-zinc-500">Supports JSON, CSV (API syncs coming soon)</p>
            <Button className="mt-3" variant="outline">Choose File</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-zinc-500">Parsed Items</p><p className="text-xl font-semibold">1,204</p></div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-zinc-500">Duplicates</p><p className="text-xl font-semibold">48</p></div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-zinc-500">Warnings</p><p className="text-xl font-semibold">17</p></div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="mb-2 text-sm font-medium">Validation Pipeline</p>
            <div className="space-y-2 text-sm text-zinc-300">
              {['Schema parse', 'Duplicate resolver', 'Category mapper', 'Scoring precheck'].map((step, i) => <div key={step} className="flex items-center justify-between"><span>{step}</span>{i < 3 ? <CheckCircle2 className="size-4 text-emerald-400" /> : <RefreshCw className="size-4 animate-spin text-zinc-400" />}</div>)}
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
          <CardHeader><CardTitle className="text-base">Import Activity</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">{['Nike Spring 26 catalog imported', 'CSV from partner validated', 'Metadata backfill complete'].map((a) => <div key={a} className="rounded-lg border border-zinc-800 px-3 py-2 text-zinc-300">{a}</div>)}</CardContent>
        </Card>
        <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
          <CardHeader><CardTitle className="text-base">Failed Imports Retry Queue</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-zinc-300"><div className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2"><span>hoka_batch_5.csv</span><Button size="sm" variant="outline">Retry</Button></div><p className="flex items-center gap-2 text-amber-300"><AlertTriangle className="size-4" />2 rows missing required category mapping.</p></CardContent>
        </Card>
        <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><DatabaseZap className="size-4" />Sample JSON Schema</CardTitle></CardHeader>
          <CardContent><pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300">{`{ "name": "Trail Shell", "brandId": "arcteryx", "category": "top", "weatherSuitability": { "rain": 0.9 } }`}</pre><Badge variant="outline" className="mt-2 border-zinc-700">Valid sample</Badge></CardContent>
        </Card>
      </div>
    </section>
  );
}