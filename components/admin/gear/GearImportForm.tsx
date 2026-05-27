"use client";

import { AlertTriangle, CheckCircle2, Circle, Clock3, Loader2, RefreshCw, UploadCloud, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { stat } from "fs";

const workflowSteps = [
  "Upload",
  "Validate",
  "Resolve Issues",
  "Preview Changes",
  "Complete Import",
] as const;

const metricCards = [
  { label: "Rows parsed", value: "1,204", tone: "text-zinc-100" },
  { label: "Valid rows", value: "1,181", tone: "text-emerald-300" },
  { label: "Rows needing review", value: "17", tone: "text-amber-300" },
  { label: "Skipped rows", value: "6", tone: "text-red-300" },
  { label: "Processing duration", value: "00:01:43", tone: "text-blue-300" },
  { label: "Last updated", value: "12:44:08 PM", tone: "text-zinc-300" },
] as const;

const panelClass = "rounded-xl border border-zinc-800 bg-zinc-950/60";

const pipelineStages = [
  { name: "Schema Parse",
    detail: "Required fields, type checks",
    rows: "1,204 rows",
    duration: "4.2s",
    state: "completed" as const,
  },
  {
    name: "Duplicate Resolver",
    detail: "48 potential matches",
    rows: "48 rows",
    duration: "9.4s",
    state: "warning" as const,
  },
  {
    name: "Category Mappper",
    detail: "17 unresoved rows",
    rows: "17 rows",
    duration: "6.0s",
    state: "blocked" as const,
  },
  {
    name: "Scoring Precheck",
    detail: "Running confidence scoring",
    rows: "1,187 rows",
    duration: "Running...",
    state: "active" as const,
  }
] as const;

const previewRows = [
  { brand: "Nike", product: "AeroDry Performance Tee", category: "Top", status: "Ready", confidence: "99%" },
  { brand: "Expntl Athletics", product: "Divergent 2-in-1 Running Short", category: "Bottom", status: "Duplicate", confidence: "85%" },
  { brand: "Arc'teryx", product: "Trail Shell Jacket", category: "Outerwear", status: "Warning", confidence: "75%" },
  { brand: "On", product: "Weather Jacket", category: "-", status: "Missing Mapping", confidence: "60%" },
] as const;

const activityLogs = [
  "12:42 PM - nike_spring26.csv imported • 1,204 rows • 98% success",
  "11:18 AM - expntl_athletics.csv imported • 850 rows • 96% success",
  "09:56 AM - partner_feed_reef.json imported • 2,112 rows • 99% success"
] as const;

const retryQueue = [
  { file: "hoka_batch_5.csv", retries: 2, uploaded: "Today 11:09 AM", reason: "2 rows missing category mapping", severity: "warning" as const },
  { file: "on_running_mens.csv", retries: 4, uploaded: "Today 10:31 AM", reason: "Duplicate SKU conflict in 11 rows", severity: "critical" as const },
] as const;

function statusBadgeTone(status: string) {
  if (status === "Valid") return "border-emerald-500/10 text-emerald-300";
  if (status === "Warning") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (status === "Duplicate") return "border-blue-500/40 bg-blue-500/10 text-blue-300";
  return "border-red-500/40 bg-red-500/10 text-red-300";
}

export function GearImportForm() {
  const activeStep = 3; // This would be dynamic in a real implementation based on the workflow state

  return (
    <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
        <CardHeader className="space-y-4">
          <div>
            <CardTitle className="flex items-center gap-2"><UploadCloud className="size-5 text-zinc-400" />Import Workflow</CardTitle>
            <CardDescription>Prepare and verify incoming catalog data before writing to production gear inventory.</CardDescription>
          </div>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {workflowSteps.map((step, index) => {
              const isComplete = index < activeStep;
              const isActive = index === activeStep;
              return (
                <li key={step} className="relative rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2 text-xs text-zinc-300">
                  <div className="flex items-center gap-2">
                    {isComplete ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : isActive ? <Loader2 className="size-3.5 animate-spin text-blue-400" /> : <Circle className="size-3.5 text-zinc-500" />}
                    <span className={isActive ? "text-zinc-100" : ""}>{step}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr">
            <div className={`${panelClass} p-5 transition-colors hover:border-zinc-700`}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-200">Upload Source File</p>
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Uploaded</Badge>
              </div>
              <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60 p-6 text-center transition-all hover:border-blue-500/40">
                <UploadCloud className="mx-auto mb-2 size-5 text-zinc-400" />
                <p className="text-sm text-zinc-500">nike_spring_26.csv ready for import</p>
                <p className="mt-1 text-xs text-zinc-500">Idle • Drag active • Uploading • Completed</p>
                <div className="mt-4 h-1.5 rounded-full bg-zinc-800">
                  <div className="h-full w-full rounded-full bg-blue-500 transition-all" />
                </div>
                <Button className="mt-4" variant="outline">Replace File</Button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {metricCards.map((metric) => (
                <div key={metric.label} className={`${panelClass} p-3`}>
                  <p className="text-xs text-zinc-500">{metric.label}</p>
                  <p className={`mt-1 text-lg font-semibold ${metric.tone}`}>{metric.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className={`${panelClass} p-4`}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-100">Validation Pipeline</p>
              <span className="flex items-center gap-1.5 text-xs text-blue-300"><Loader2 className="size-3.5 animate-spin" />Processing</span>
            </div>
            <div className="space-y-2">
              {pipelineStages.map((stage) => {
                const icon = stage.state === "completed" ? <CheckCircle2 className="size-4 text-emerald-400" /> : stage.state === "active" ? <RefreshCw className="size-4 animate-spin text-blue-400" /> : stage.state === "warning" ? <AlertTriangle className="size-4 text-amber-400" /> : <XCircle className="size-4 text-red-400" />;

                const badgeTone = stage.state === "completed" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : stage.state === "active" ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : stage.state === "warning" ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-red-500/40 bg-red-500/10 text-red-300";

                return (
                  <div key={stage.name} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:border-zinc-700">
                    <div className="flex items-center gap-2">
                      <span className="mt-0.5">{icon}</span>
                      <div>
                        <p className="text-sm text-zinc-200">{stage.name}</p>
                        <p className="text-xs text-zinc-500">{stage.detail}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400">{stage.rows}</span>
                      <Badge variant="outline" className={badgeTone}>{stage.duration}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          
          <div className={`${panelClass} overflow-hidden`}>
            <div className="border-b border-zinc-800 px-4 py-3">
              <p className="text-sm font-medium text-zinc-100">Preview Changes</p>
              <p className="text-xs text-zinc-500">Review row-level outcomes before completing the import.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/70 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Brand</th>
                    <th className="px-4 py-2 text-left">Product</th>
                    <th className="px-4 py-2 text-left">Category</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.product} className="border-t border-zinc-800 text-zinc-300 hover:bg-zinc-900/40">
                      <td className="px-4 py-2">{row.brand}</td>
                      <td className="px-4 py-2">{row.product}</td>
                      <td className="px-4 py-2">{row.category}</td>
                      <td className="px-4 py-2"><Badge variant="outline" className={statusBadgeTone(row.status)}>{row.status}</Badge></td>
                      <td className="px-4 py-2">{row.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
          <CardHeader><CardTitle className="text-base">Import Activity</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {activityLogs.map((entry) => (
              <div key={entry} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-zinc-300">{entry}</div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
          <CardHeader><CardTitle className="text-base">Retry Queue</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-zinc-300">
            {retryQueue.map((item) => (
              <div key={item.file} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="font-medium text-zinc-200">{item.file}</p>
                  <Badge variant="outline" className={item.severity === "critical" ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}>{item.severity === "critical" ? "Blocking" : "Warning"}</Badge>
                </div>
                <p className="text-xs text-zinc-500">{item.uploaded} • Retry count: {item.retries}</p>
                <p className="mt-1 text-xs text-zinc-400">Failure reason: {item.reason}</p>
                <Button size="sm" variant="outline" className="mt-3">Retry Import</Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="size-4" />Operator Decision</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <p className="text-sm text-zinc-300">Can I safely import this data? <span className="text-amber-300">Not yet</span> - resolve 17 unmapped rows and 48 duplicate matches first.</p>
            <Button className="mt-3 w-full" disabled>Complete Import (blocked)</Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}