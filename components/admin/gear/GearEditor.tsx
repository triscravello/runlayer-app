"use client";
import { useMemo, useState } from "react";
import { Sparkles, ImagePlus, RefreshCcw, AlertTriangle, Archive, Check, ChevronDown, Clock3, GripVertical, Loader2, UploadCloud, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

const recommendationChecks = [
  { label: "Weather coverage", complete: true },
  { label: "Activity tagging", complete: true }, 
  { label: "Fallback image", complete: true },
  { label: "Cold weather metadata", complete: true },
];

const metadataGroups = [
  { label: "Activities", values: ["Road Running", "Tempo", "Interval"] },
  { label: "Weather", values: ["Hot", "Humid", "Rain"] },
  { label: "Fit", values: ["Slim", "Regular", "Relaxed"] ,}
];

const intensityLevels = [
  { label: "Easy", enabled: false },
  { label: "Tempo", enabled: true },
  { label: "Interval", enabled: true },
  { label: "Race Day", enabled: true },
];

function SectionHeader({
  title,
  description,
  badge
} : {
  title: string;
  description?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
          {title}
        </h2>

        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {description}
          </p>
        ) : null}
      </div>

      {badge}
    </div>
  );
}

function EditorSection({
  title, 
  description,
  children,
  defaultOpen = true,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/60">
      <button 
        type="button" 
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-4 text-left transition hover:bg-zinc-900/60"
      >
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>

          {description ? (
            <p className="mt-1 text-xs text-zinc-500">{description}</p>
          ) : null}
        </div>

        <ChevronDown className={`size-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="border-t border-zinc-800/80 p-4">{children}</div>
      ) : null}
    </div>
  )
}

function FieldLabel({
  label, 
  hint,
} : {
  label: string;
  hint?: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <label className="text-xs font-medium text-zinc-300">{label}</label>

      {hint ? (
        <span className="text-[11px] text-zinc-500">{hint}</span>
      ) : null}
    </div>
  );
}

export function GearEditor() {
  const completion = useMemo(() => {
    const completed = recommendationChecks.filter(
      (item) => item.complete
    ).length;

    return Math.round((completed / recommendationChecks.length) * 100);
  }, []);

  return (
    <div className="space-y-4 xl:sticky xl:top-24">
      {/* Save State */}
      <Card className="overflow-hidden rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
              <Loader2 className="size-4 text-emerald-300" />
            </div>

            <div>
              <p className="text-sm font-medium text-emerald-100">
                Autosaving changes…
              </p>

              <p className="text-xs text-emerald-200/70">
                Last synced 12 seconds ago
              </p>
            </div>
          </div>

          <Badge className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
            Synced
          </Badge>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* LEFT COLUMN */}
        <div className="space-y-4">
          {/* Basic Info */}
          <Card className="rounded-3xl border border-zinc-800/80 bg-zinc-900/80 shadow-2xl shadow-black/20">
            <CardContent className="space-y-6 p-5">
              <SectionHeader
                title="Basic Information"
                description="Primary product information used throughout recommendation surfaces and search indexing."
                badge={
                  <Badge className="border border-amber-500/20 bg-amber-500/10 text-amber-300">
                    Draft
                  </Badge>
                }
              />

              <div className="space-y-4">
                <div>
                  <FieldLabel
                    label="Gear Name"
                    hint="Required"
                  />

                  <Input
                    defaultValue="AeroDry Performance Tee"
                    className="border-zinc-700 bg-zinc-950 text-zinc-100"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <FieldLabel label="Brand" />

                    <Input
                      defaultValue="Nike"
                      className="border-zinc-700 bg-zinc-950 text-zinc-100"
                    />
                  </div>

                  <div>
                    <FieldLabel label="Category" />

                    <select className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-0 transition focus:border-zinc-500">
                      <option>Top</option>
                      <option>Bottom</option>
                      <option>Outerwear</option>
                      <option>Accessory</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <FieldLabel
                      label="Description"
                      hint="142 / 240 characters"
                    />

                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                    >
                      <Sparkles className="size-3.5" />
                      Improve with AI
                    </Button>
                  </div>

                  <textarea
                    rows={5}
                    defaultValue="Lightweight technical tee designed for warm-weather runs with moisture-wicking mesh zones and fast-drying performance fabric."
                    className="w-full rounded-xl border border-amber-500/30 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 shadow-[0_0_0_1px_rgba(245,158,11,0.12)] outline-none transition focus:border-zinc-500"
                  />

                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span className="text-zinc-500">
                      AI-enhanced description
                    </span>

                    <span className="text-emerald-300">
                      Recommendation confidence: High
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Media */}
          <EditorSection
            title="Media Library"
            description="Upload, reorder, and manage product imagery."
          >
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                {/* Primary */}
                <div className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
                  <div className="aspect-[4/3] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_60%)]" />

                  <div className="absolute left-3 top-3">
                    <Badge className="bg-black/70 text-white backdrop-blur">
                      Primary Image
                    </Badge>
                  </div>

                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-white/10 bg-black/50 px-4 py-3 backdrop-blur">
                    <div>
                      <p className="text-sm font-medium text-white">
                        aerodry-front.jpg
                      </p>

                      <p className="text-xs text-zinc-300">
                        2400 × 2400
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant="secondary"
                      className="bg-white text-black hover:bg-zinc-200"
                    >
                      Replace
                    </Button>
                  </div>
                </div>

                {/* Gallery */}
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2, 3].map((item) => (
                    <div
                      key={item}
                      className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
                    >
                      <div className="aspect-square bg-zinc-950" />

                      <button className="absolute right-2 top-2 rounded-md border border-white/10 bg-black/50 p-1 text-zinc-300 opacity-0 transition group-hover:opacity-100">
                        <GripVertical className="size-3.5" />
                      </button>
                    </div>
                  ))}

                  <button className="flex aspect-square flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/60 transition hover:border-zinc-500 hover:bg-zinc-900">
                    <UploadCloud className="mb-2 size-5 text-zinc-500" />

                    <span className="text-xs text-zinc-400">
                      Upload Image
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-500/10 text-emerald-300">
                  4 images uploaded
                </Badge>

                <Badge className="bg-zinc-800 text-zinc-300">
                  CDN Optimized
                </Badge>

                <Badge className="bg-zinc-800 text-zinc-300">
                  WebP Generated
                </Badge>
              </div>
            </div>
          </EditorSection>

          {/* AI Preview */}
          <EditorSection
            title="Recommendation Explanation"
            description="Preview how the recommendation engine explains this gear to runners."
          >
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <div className="mt-0.5 flex size-9 items-center justify-center rounded-full border border-violet-500/20 bg-violet-500/10">
                    <Wand2 className="size-4 text-violet-300" />
                  </div>

                  <div>
                    <p className="text-sm leading-relaxed text-zinc-300">
                      Optimized for{" "}
                      <span className="font-medium text-white">
                        tempo and interval workouts
                      </span>{" "}
                      in{" "}
                      <span className="font-medium text-white">
                        warm, humid conditions
                      </span>
                      , where lightweight moisture management improves cooling
                      and comfort over extended efforts.
                    </p>

                    <p className="mt-2 text-xs text-zinc-500">
                      Generated 2 minutes ago · Confidence score 82%
                    </p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="border-zinc-700 bg-zinc-900"
                >
                  <RefreshCcw className="mr-2 size-3.5" />
                  Regenerate
                </Button>
              </div>
            </div>
          </EditorSection>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-4">
          {/* Quality */}
          <Card className="rounded-3xl border border-zinc-800/80 bg-zinc-900/80">
            <CardContent className="space-y-5 p-5">
              <SectionHeader
                title="Recommendation Quality"
                description="Metadata completeness and recommendation readiness."
              />

              <div>
                <div className="mb-2 flex items-end justify-between">
                  <div>
                    <p className="text-4xl font-semibold tracking-tight text-white">
                      {completion}%
                    </p>

                    <p className="text-xs text-zinc-500">
                      Recommendation readiness
                    </p>
                  </div>

                  <Badge className="bg-emerald-500/10 text-emerald-300">
                    High Confidence
                  </Badge>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-zinc-100"
                    style={{ width: `${completion}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                {recommendationChecks.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      {item.complete ? (
                        <Check className="size-4 text-emerald-300" />
                      ) : (
                        <AlertTriangle className="size-4 text-amber-300" />
                      )}

                      <span className="text-sm text-zinc-300">
                        {item.label}
                      </span>
                    </div>

                    <span className="text-xs text-zinc-500">
                      {item.complete ? "Complete" : "Needs attention"}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Metadata */}
          <EditorSection
            title="Recommendation Metadata"
            description="Controls recommendation engine targeting."
          >
            <div className="space-y-4">
              {metadataGroups.map((group) => (
                <div key={group.label}>
                  <FieldLabel label={group.label} />

                  <div className="flex flex-wrap gap-2">
                    {group.values.map((value) => (
                      <button
                        key={value}
                        className="group inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-800"
                      >
                        {value}

                        <span className="text-zinc-500 transition group-hover:text-zinc-300">
                          ×
                        </span>
                      </button>
                    ))}

                    <button className="rounded-full border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 transition hover:border-zinc-500 hover:text-zinc-300">
                      + Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </EditorSection>

          {/* Weather */}
          <EditorSection
            title="Weather Conditions"
            description="Controls environmental compatibility."
          >
            <div className="space-y-4">
              <div>
                <FieldLabel label="Temperature Range (°F)" />

                <div className="flex items-center gap-2">
                  <Input
                    defaultValue="62"
                    className="border-zinc-700 bg-zinc-950"
                  />

                  <span className="text-zinc-500">to</span>

                  <Input
                    defaultValue="88"
                    className="border-zinc-700 bg-zinc-950"
                  />
                </div>
              </div>

              <div>
                <FieldLabel label="Precipitation Tolerance" />

                <select className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100">
                  <option>Dry only</option>
                  <option>Light drizzle</option>
                  <option>Rain-ready</option>
                </select>
              </div>
            </div>
          </EditorSection>

          {/* Intensity */}
          <EditorSection
            title="Intensity Compatibility"
            description="Select workout types supported by this gear."
            defaultOpen={false}
          >
            <div className="space-y-2">
              {intensityLevels.map((item) => (
                <label
                  key={item.label}
                  className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-3 transition ${
                    item.enabled
                      ? "border-zinc-700 bg-zinc-900"
                      : "border-zinc-800 bg-zinc-950/50"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-200">
                      {item.label}
                    </p>

                    <p className="text-xs text-zinc-500">
                      Optimized recommendation support
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    defaultChecked={item.enabled}
                    className="size-4 accent-zinc-100"
                  />
                </label>
              ))}
            </div>
          </EditorSection>

          {/* Publishing */}
          <Card className="overflow-hidden rounded-3xl border border-zinc-700/80 bg-zinc-950 shadow-2xl shadow-black/20">
            <CardContent className="space-y-5 p-5">
              <SectionHeader
                title="Publishing Workflow"
                description="Control visibility and deployment status."
              />

              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <div className="flex items-start gap-3">
                  <Clock3 className="mt-0.5 size-4 text-amber-300" />

                  <div>
                    <p className="text-sm font-medium text-amber-100">
                      Draft pending review
                    </p>

                    <p className="mt-1 text-xs leading-relaxed text-amber-200/70">
                      Missing cold-weather metadata before recommendation
                      indexing is fully enabled.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-xs text-zinc-500">
                <p>Last updated · May 28, 2026 at 07:51 UTC</p>

                <p>Edited by · admin@runlayer.io</p>
              </div>

              <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 border-t border-zinc-800 bg-zinc-950/90 p-5 backdrop-blur-xl">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="border-zinc-700 bg-zinc-900"
                  >
                    Save Draft
                  </Button>

                  <Button className="flex-1 bg-zinc-100 text-zinc-900 hover:bg-white">
                    Publish Update
                  </Button>

                  <Button
                    variant="outline"
                    className="border-zinc-700 bg-zinc-900"
                  >
                    <Archive className="mr-2 size-4" />
                    Archive
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}