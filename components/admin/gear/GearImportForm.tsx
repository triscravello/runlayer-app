"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export const ADMIN_GEAR_IMPORT_EVENT = "runlayer:admin:gear-import";

type ImportPreviewRow = {
  row: number;
  name: string;
  brand: string;
  category: string;
  priceRange: string;
  status: "valid" | "invalid";
  errors: string[]; 
};

type ImportResponse = {
  mode: "dry-run" | "commit";
  parsedRows: number;
  validRows: number;
  invalidRows: number;
  rows: ImportPreviewRow[];
  imported?: {
    total: number;
    inserted: number;
    updated: number;
    failed: Array<{ name: string; reason: string }>;
  };
};

async function submitImport(file: File, mode: "dry-run" | "commit") {
  const body = new FormData();
  body.append("file", file);
  body.append("mode", mode);

  const response = await fetch("/api/admin/gear/import", { method: "POST", body });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? "Import request failed.");
  }

  return payload as ImportResponse;
}

function statusClass(status: ImportPreviewRow["status"]) {
  return status === "valid" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-red-500/20 bg-red-500/10 text-red-300";
}

export function GearImportForm() {
  const router = useRouter();
  const sectionRef = useRef<HTMLElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [filter, setFilter] = useState<"all" | "valid" | "invalid">("all");
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleImportClick = () => sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.addEventListener(ADMIN_GEAR_IMPORT_EVENT, handleImportClick);
    return () => window.removeEventListener(ADMIN_GEAR_IMPORT_EVENT, handleImportClick);
  }, []);

  const filteredRows = useMemo(() => {
    if (!preview) return [];
    if (filter === "all") return preview.rows;
    return preview.rows.filter((row) => row.status === filter);
  }, [filter, preview]);

  const handleDryRun = async () => {
    if (!file) {
      setError("Choose a CSV or JSON file before validating.");
      return;
    }

    setError(null);
    setPreview(null);
    setIsDryRunning(true);

    try {
      setPreview(await submitImport(file, "dry-run"));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message: "Import validation failed");
    } finally {
      setIsDryRunning(false);
    }
  };

  const handleCommit = async () => {
    if (!file || !preview) return;
    
    const confirmed = window.confirm(`Import ${preview.validRows} valid gear row${preview.validRows === 1 ? "" : "s"}? Invalid rows will be skipped.`);
    if (!confirmed) return;

    setError(null);
    setIsImporting(true);
    try {
      setPreview(await submitImport(file, "commit"));
      router.refresh();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message: "Import commit failed");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section ref={sectionRef} className="scroll-mt-6" id="gear-import">
      <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
        <CardHeader className="space-y-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UploadCloud className="size-5 text-zinc-400" /> Bulk Import
          </CardTitle>
          <CardDescription className="max-w-3xl text-zinc-400">
            Upload CSV or JSON, run a server-side dry-run, review row-level errors, then import only the valid rows after confirmation. Required fields: name, brandId or brand, category, and priceRange.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-200">CSV or JSON file</span>
              <Input
                type="file"
                accept=".csv,.json,text/csv,application/json"
                className="border-zinc-700 bg-zinc-950/60 text-zinc-200 file:text-zinc-300"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  setPreview(null);
                  setError(null);
                }}
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleDryRun} disabled={!file || isDryRunning || isImporting} className="border-zinc-700 bg-zinc-950/60 text-zinc-100">
                {isDryRunning ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />} Dry-run validation
              </Button>
              <Button type="button" onClick={handleCommit} disabled={!file || !preview || preview.validRows === 0 || isDryRunning || isImporting}>
                {isImporting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Import valid rows
              </Button>
            </div>
          </div>

          {file ? <p className="text-xs text-zinc-500">Selected: {file.name} ({Math.ceil(file.size / 1024).toLocaleString()} KB)</p> : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
              <XCircle className="mt-0.5 size-4" /> {error}
            </div>
          ) : null}

          {preview ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"><p className="text-xs uppercase text-zinc-500">Parsed rows</p><p className="mt-2 text-2xl font-semibold">{preview.parsedRows}</p></div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4"><p className="text-xs uppercase text-emerald-300/80">Valid rows</p><p className="mt-2 text-2xl font-semibold text-emerald-300">{preview.validRows}</p></div>
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4"><p className="text-xs uppercase text-red-300/80">Invalid rows</p><p className="mt-2 text-2xl font-semibold text-red-300">{preview.invalidRows}</p></div>
                {preview.imported ? <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4"><p className="text-xs uppercase text-blue-300/80">Inserted</p><p className="mt-2 text-2xl font-semibold text-blue-300">{preview.imported.inserted}</p></div> : null}
                {preview.imported ? <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4"><p className="text-xs uppercase text-amber-300/80">Updated</p><p className="mt-2 text-2xl font-semibold text-amber-300">{preview.imported.updated}</p></div> : null}
            </div>

            {preview.invalidRows > 0 ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                  <AlertTriangle className="mt-0.5 size-4" /> Invalid rows are not imported. Fix the source file and run validation again, or confirm import to write only valid rows.
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {(["all", "valid", "invalid"] as const).map((nextFilter) => (
                  <Button key={nextFilter} type="button" size="sm" variant={filter === nextFilter ? "default" : "outline"} onClick={() => setFilter(nextFilter)}>
                    {nextFilter === "all" ? "All" : nextFilter[0].toUpperCase() + nextFilter.slice(1)}
                  </Button>
                  ))}
              </div>

              <div className="overflow-hidden rounded-2xl border border-zinc-800/80">
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="sticky top-0 bg-zinc-900/95 text-xs uppercase tracking-wide text-zinc-500 backdrop-blur">
                      <tr><th className="px-4 py-3 text-left">Row</th><th className="px-4 py-3 text-left">Brand</th><th className="px-4 py-3 text-left">Product</th><th className="px-4 py-3 text-left">Category</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Errors</th></tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row) => (
                        <tr key={row.row} className="border-t border-zinc-800/80 text-zinc-300">
                          <td className="px-4 py-3 font-mono text-xs">{row.row}</td>
                          <td className="px-4 py-3">{row.brand || "—"}</td>
                          <td className="px-4 py-3">{row.name || "—"}</td>
                          <td className="px-4 py-3">{row.category || "—"}</td>
                          <td className="px-4 py-3"><Badge variant="outline" className={statusClass(row.status)}>{row.status}</Badge></td>
                          <td className="px-4 py-3 text-xs text-zinc-400">{row.errors.length ? row.errors.join("; ") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}