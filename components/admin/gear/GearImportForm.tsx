"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Loader2,
  RefreshCw,
  UploadCloud,
  XCircle,
  FileSpreadsheet,
  ChevronRight,
  ShieldAlert,
  ArrowUpRight,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";

type WorkflowStep =
  | "upload"
  | "validate"
  | "resolve"
  | "preview"
  | "complete";

type PipelineState =
  | "queued"
  | "running"
  | "completed"
  | "warning"
  | "failed";

const workflowSteps: {
  id: WorkflowStep;
  label: string;
}[] = [
  { id: "upload", label: "Upload" },
  { id: "validate", label: "Validate" },
  { id: "resolve", label: "Resolve Issues" },
  { id: "preview", label: "Preview" },
  { id: "complete", label: "Complete" },
];

const metrics = [
  {
    label: "Rows parsed",
    value: "1,204",
  },
  {
    label: "Valid rows",
    value: "1,181",
    tone: "text-emerald-300",
  },
  {
    label: "Needs review",
    value: "65",
    tone: "text-amber-300",
  },
  {
    label: "Blocked rows",
    value: "17",
    tone: "text-red-300",
  },
];

const pipelineStages: {
  name: string;
  detail: string;
  processed: number;
  total: number;
  duration: string;
  state: PipelineState;
}[] = [
  {
    name: "Schema Validation",
    detail: "Required fields and formatting checks",
    processed: 1204,
    total: 1204,
    duration: "4.2s",
    state: "completed",
  },
  {
    name: "Duplicate Detection",
    detail: "48 potential inventory conflicts detected",
    processed: 1204,
    total: 1204,
    duration: "8.9s",
    state: "warning",
  },
  {
    name: "Category Mapping",
    detail: "17 rows awaiting manual mapping",
    processed: 1187,
    total: 1204,
    duration: "6.1s",
    state: "failed",
  },
  {
    name: "Scoring & Enrichment",
    detail: "Generating confidence scores",
    processed: 932,
    total: 1204,
    duration: "Running",
    state: "running",
  },
];

const previewRows = [
  {
    brand: "Nike",
    product: "AeroDry Performance Tee",
    category: "Top",
    status: "Ready",
    confidence: 99,
  },
  {
    brand: "Expntl Athletics",
    product: "Divergent 2-in-1 Running Short",
    category: "Bottom",
    status: "Duplicate",
    confidence: 84,
  },
  {
    brand: "Arc'teryx",
    product: "Trail Shell Jacket",
    category: "Outerwear",
    status: "Warning",
    confidence: 73,
  },
  {
    brand: "On",
    product: "Weather Jacket",
    category: "—",
    status: "Missing Mapping",
    confidence: 61,
  },
];

const importActivity = [
  {
    file: "nike_spring26.csv",
    rows: "1,204 rows",
    outcome: "98% validated",
    time: "2m ago",
  },
  {
    file: "expntl_athletics.csv",
    rows: "850 rows",
    outcome: "96% validated",
    time: "1h ago",
  },
  {
    file: "partner_feed_reef.json",
    rows: "2,112 rows",
    outcome: "99% validated",
    time: "3h ago",
  },
];

const retryQueue = [
  {
    file: "hoka_batch_05.csv",
    issue: "2 rows missing category mapping",
    retries: 2,
    severity: "warning",
  },
  {
    file: "on_running_mens.csv",
    issue: "Duplicate SKU conflict across 11 rows",
    retries: 4,
    severity: "critical",
  },
];

const STATUS_CONFIG: Record<
  PipelineState,
  {
    icon: React.ReactNode;
    badge: string;
    progress: string;
  }
> = {
  queued: {
    icon: <CircleDashed className="size-4 text-zinc-500" />,
    badge:
      "border-zinc-700 bg-zinc-900/80 text-zinc-400",
    progress: "bg-zinc-700",
  },
  running: {
    icon: (
      <RefreshCw className="size-4 animate-spin text-blue-400" />
    ),
    badge:
      "border-blue-500/20 bg-blue-500/10 text-blue-300",
    progress: "bg-blue-500",
  },
  completed: {
    icon: (
      <CheckCircle2 className="size-4 text-emerald-400" />
    ),
    badge:
      "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    progress: "bg-emerald-500",
  },
  warning: {
    icon: (
      <AlertTriangle className="size-4 text-amber-400" />
    ),
    badge:
      "border-amber-500/20 bg-amber-500/10 text-amber-300",
    progress: "bg-amber-500",
  },
  failed: {
    icon: <XCircle className="size-4 text-red-400" />,
    badge:
      "border-red-500/20 bg-red-500/10 text-red-300",
    progress: "bg-red-500",
  },
};

function getRowStatusTone(status: string) {
  switch (status) {
    case "Ready":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";

    case "Duplicate":
      return "border-amber-500/20 bg-amber-500/10 text-amber-300";

    case "Warning":
      return "border-yellow-500/20 bg-yellow-500/10 text-yellow-300";

    default:
      return "border-red-500/20 bg-red-500/10 text-red-300";
  }
}

export function GearImportForm() {
  const [activeFilter, setActiveFilter] = useState("All");

  const activeStep = 3;

  const filteredRows = useMemo(() => {
    if (activeFilter === "All") return previewRows;

    return previewRows.filter(
      (row) => row.status === activeFilter,
    );
  }, [activeFilter]);

  return (
    <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
        <CardHeader className="space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <UploadCloud className="size-5 text-zinc-400" />
                Gear Import Workflow
              </CardTitle>

              <CardDescription className="mt-1 max-w-2xl text-sm text-zinc-400">
                Validate incoming catalog data, resolve conflicts,
                and preview inventory changes before syncing to
                production.
              </CardDescription>
            </div>

            <Badge
              variant="outline"
              className="w-fit border-blue-500/20 bg-blue-500/10 text-blue-300"
            >
              Validation in progress
            </Badge>
          </div>

          <ol className="grid gap-2 sm:grid-cols-5">
            {workflowSteps.map((step, index) => {
              const isComplete = index < activeStep;
              const isActive = index === activeStep;

              return (
                <li
                  key={step.id}
                  className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3"
                >
                  <div className="flex items-center gap-2">
                    {isComplete ? (
                      <CheckCircle2 className="size-4 text-emerald-400" />
                    ) : isActive ? (
                      <Loader2 className="size-4 animate-spin text-blue-400" />
                    ) : (
                      <CircleDashed className="size-4 text-zinc-600" />
                    )}

                    <span
                      className={`text-sm ${
                        isActive
                          ? "font-medium text-zinc-100"
                          : "text-zinc-400"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-100">
                    Source File
                  </p>

                  <p className="mt-1 text-sm text-zinc-500">
                    Upload a structured CSV or JSON inventory feed.
                  </p>
                </div>

                <Badge
                  variant="outline"
                  className="border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                >
                  Uploaded
                </Badge>
              </div>

              <div className="mt-5 rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-zinc-800/80 p-2">
                    <FileSpreadsheet className="size-5 text-zinc-300" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-200">
                      nike_spring26.csv
                    </p>

                    <p className="mt-1 text-xs text-zinc-500">
                      1,204 rows • 842 KB • uploaded 2m ago
                    </p>

                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span>Validation progress</span>
                        <span>82%</span>
                      </div>

                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full w-[82%] rounded-full bg-blue-500" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="outline">
                    Replace File
                  </Button>

                  <Button variant="ghost">
                    Download Validation Report
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {metrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4"
                >
                  <p className="text-xs uppercase tracking-wide text-zinc-500">
                    {metric.label}
                  </p>

                  <p
                    className={`mt-2 text-2xl font-semibold text-zinc-100 ${
                      metric.tone ?? ""
                    }`}
                  >
                    {metric.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Validation Pipeline
                </p>

                <p className="mt-1 text-xs text-zinc-500">
                  Import stages update progressively as rows are
                  processed.
                </p>
              </div>

              <Badge
                variant="outline"
                className="border-blue-500/20 bg-blue-500/10 text-blue-300"
              >
                Processing
              </Badge>
            </div>

            <div className="space-y-3">
              {pipelineStages.map((stage) => {
                const config = STATUS_CONFIG[stage.state];

                const percentage = Math.round(
                  (stage.processed / stage.total) * 100,
                );

                return (
                  <div
                    key={stage.name}
                    className="rounded-xl bg-zinc-900/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 gap-3">
                        <div className="mt-0.5">
                          {config.icon}
                        </div>

                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-100">
                            {stage.name}
                          </p>

                          <p className="mt-1 text-xs text-zinc-500">
                            {stage.detail}
                          </p>
                        </div>
                      </div>

                      <Badge
                        variant="outline"
                        className={config.badge}
                      >
                        {stage.duration}
                      </Badge>
                    </div>

                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                        <span>
                          {stage.processed.toLocaleString()} /{" "}
                          {stage.total.toLocaleString()} rows
                        </span>

                        <span className="font-mono">
                          {percentage}%
                        </span>
                      </div>

                      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`h-full rounded-full ${config.progress}`}
                          style={{
                            width: `${percentage}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40">
            <div className="border-b border-zinc-800/80 px-4 py-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-100">
                    Preview Changes
                  </p>

                  <p className="mt-1 text-xs text-zinc-500">
                    Review affected inventory rows before import.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {[
                    "All",
                    "Duplicate",
                    "Warning",
                    "Missing Mapping",
                  ].map((filter) => (
                    <Button
                      key={filter}
                      size="sm"
                      variant={
                        activeFilter === filter
                          ? "default"
                          : "outline"
                      }
                      onClick={() => setActiveFilter(filter)}
                    >
                      {filter}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-900/95 text-xs uppercase tracking-wide text-zinc-500 backdrop-blur">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      Brand
                    </th>

                    <th className="px-4 py-3 text-left">
                      Product
                    </th>

                    <th className="px-4 py-3 text-left">
                      Category
                    </th>

                    <th className="px-4 py-3 text-left">
                      Status
                    </th>

                    <th className="px-4 py-3 text-left">
                      Confidence
                    </th>

                    <th className="px-4 py-3 text-right">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={row.product}
                      className="border-t border-zinc-800/80 text-zinc-300 transition-colors hover:bg-zinc-900/30"
                    >
                      <td className="px-4 py-3">
                        {row.brand}
                      </td>

                      <td className="px-4 py-3">
                        {row.product}
                      </td>

                      <td className="px-4 py-3">
                        {row.category}
                      </td>

                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={getRowStatusTone(
                            row.status,
                          )}
                        >
                          {row.status}
                        </Badge>
                      </td>

                      <td className="px-4 py-3 font-mono text-xs">
                        {row.confidence}%
                      </td>

                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                        >
                          Review
                          <ChevronRight className="size-4" />
                        </Button>
                      </td>
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
          <CardHeader>
            <CardTitle className="text-base">
              Recent Import Activity
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-2">
            {importActivity.map((activity) => (
              <div
                key={activity.file}
                className="rounded-xl bg-zinc-950/40 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">
                      {activity.file}
                    </p>

                    <p className="mt-1 text-xs text-zinc-500">
                      {activity.rows} • {activity.outcome}
                    </p>
                  </div>

                  <span className="text-xs text-zinc-500">
                    {activity.time}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
          <CardHeader>
            <CardTitle className="text-base">
              Retry Queue
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {retryQueue.map((item) => (
              <div
                key={item.file}
                className="rounded-xl bg-zinc-950/40 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">
                      {item.file}
                    </p>

                    <p className="mt-1 text-xs text-zinc-500">
                      Retry attempts: {item.retries}
                    </p>
                  </div>

                  <Badge
                    variant="outline"
                    className={
                      item.severity === "critical"
                        ? "border-red-500/20 bg-red-500/10 text-red-300"
                        : "border-amber-500/20 bg-amber-500/10 text-amber-300"
                    }
                  >
                    {item.severity === "critical"
                      ? "Blocking"
                      : "Warning"}
                  </Badge>
                </div>

                <div className="mt-3 rounded-lg border border-red-500/10 bg-red-500/5 p-3">
                  <p className="text-xs text-zinc-300">
                    {item.issue}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="mt-4"
                >
                  Retry Import
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-red-500/10 bg-red-500/[0.03]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
              <ShieldAlert className="size-4 text-red-300" />
              Import Decision
            </CardTitle>
          </CardHeader>

          <CardContent>
            <div className="rounded-xl border border-red-500/10 bg-zinc-950/40 p-4">
              <p className="text-sm font-medium text-zinc-100">
                Import blocked due to unresolved validation issues.
              </p>

              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">
                    Missing category mappings
                  </span>

                  <span className="font-medium text-red-300">
                    17 rows
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">
                    Potential duplicate conflicts
                  </span>

                  <span className="font-medium text-amber-300">
                    48 rows
                  </span>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <Button className="gap-2">
                  Resolve Issues
                  <ArrowUpRight className="size-4" />
                </Button>

                <Button variant="outline">
                  Export Error Report
                </Button>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
              <Clock3 className="size-3.5" />
              Last validation update 18 seconds ago
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}