"use client";


import { useState } from "react";
import Image from "next/image";
import { AlertTriangle, Check, ChevronDown, Clock3, ImageOff, Loader2, Save, Trash2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export type GearEditorItem = {
  id: string;
  name: string;
  brandId: string;
  brand?: { name?: string | null } | null;
  category: "TOP" | "BOTTOM" | "ACCESSORY";
  priceRange: "BUDGET" | "MID" | "PREMIUM";
  genderTarget?: string | null;
  subcategory?: string | null;
  tags: string[];
  bodyTypeFit: string[];
  imageUrl?: string | null;
  affiliateUrl?: string | null;
  weatherHot?: number | null;
  weatherCold?: number | null;
  weatherRain?: number | null;
  weatherWind?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type GearBrandOption = {
  id: string;
  name: string;
}

type GearEditorProps = {
  item?: GearEditorItem | null;
  mode?: "edit" | "create";
  onCreated?: (item: GearEditorItem) => void;
  onDeleted?: (itemId: string) => void;
  brands?: GearBrandOption[];
  onBrandCreated?: (brand: GearBrandOption) => void;
};

type SaveState = "idle" | "saving" | "saved" | "error";
type DeleteState = "idle" | "deleting" | "deleted" | "error";
type BrandCreateState = "idle" | "creating" | "created" | "error";

type EditableFields = {
  name: string;
  brandId: string;
  newBrandName: string;
  category: GearEditorItem["category"];
  priceRange: GearEditorItem["priceRange"];
  genderTarget: string;
  subcategory: string;
  imageUrl: string;
  affiliateUrl: string;
  tags: string;
  bodyTypeFit: string;
  weatherHot: string;
  weatherCold: string;
  weatherRain: string;
  weatherWind: string;
};

const categoryOptions: Array<GearEditorItem["category"]> = ["TOP", "BOTTOM", "ACCESSORY"];
const priceRangeOptions: Array<GearEditorItem["priceRange"]> = ["BUDGET", "MID", "PREMIUM"];
const weatherFields = [
  { key: "weatherHot", label: "Hot weather" },
  { key: "weatherCold", label: "Cold weather" },
  { key: "weatherRain", label: "Rain" },
  { key: "weatherWind", label: "Wind" },
] as const;

function hasValue(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function joinList(value?: string[] | null) {
  return value?.length ? value.join(", ") : "";
}

function formatDate(value?: Date) {
  if (!value) return "Pending";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(value);
}

function toFields(item?: GearEditorItem | null): EditableFields {
  return {
    name: item?.name ?? "",
    brandId: item?.brandId ?? "",
    newBrandName: "",
    category: item?.category ?? "TOP",
    priceRange: item?.priceRange ?? "MID",
    genderTarget: item?.genderTarget ?? "",
    subcategory: item?.subcategory ?? "",
    imageUrl: item?.imageUrl ?? "",
    affiliateUrl: item?.affiliateUrl ?? "",
    tags: joinList(item?.tags),
    bodyTypeFit: joinList(item?.bodyTypeFit),
    weatherHot: item?.weatherHot?.toString() ?? "",
    weatherCold: item?.weatherCold?.toString() ?? "",
    weatherRain: item?.weatherRain?.toString() ?? "",
    weatherWind: item?.weatherWind?.toString() ?? "",
  };
}

function parseWeatherScore(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
}

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
    <div className="overflow-hidden rounded-2xl border border-zinc-800/70 bg-zinc-950/45">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-zinc-900/60"
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
        <div className="border-t border-zinc-800/70 p-4">{children}</div>
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

function EmptyBadge({ children = "Missing" }: { children?: React.ReactNode }) {
  return <Badge className="border border-zinc-700 bg-zinc-900 text-zinc-400">{children}</Badge>
}

export function GearEditor({ item, mode = "edit", onCreated, onDeleted, brands = [], onBrandCreated }: GearEditorProps) {
  const [fields, setFields] = useState<EditableFields>(() => toFields(item));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState>("idle");
  const [brandCreateState, setBrandCreateState] = useState<BrandCreateState>("idle");

  const isCreateMode = mode === "create";

  const imageUrl = fields.imageUrl.trim();
  const tags = splitList(fields.tags);
  const bodyTypeFit = splitList(fields.bodyTypeFit);
  const weatherValues = weatherFields.map(({ key }) => parseWeatherScore(fields[key]));
  const completedFields = [
    fields.name,
    fields.brandId,
    fields.category,
    fields.priceRange,
    fields.genderTarget,
    fields.subcategory,
    imageUrl,
    fields.affiliateUrl,
    tags.length ? "tags" : "",
    bodyTypeFit.length ? "bodyTypeFit" : "",
    ...weatherValues.map((value) => value === null ? "" : String(value)),
  ].filter((value) => hasValue(String(value))).length;
  const totalFields = 14;
  const completion = Math.round((completedFields / totalFields) * 100);
  const weatherComplete = weatherValues.filter((value) => value !== null).length;
  const selectedBrand = brands.find((brand) => brand.id === fields.brandId) ?? null;

  const updateField = (key: keyof EditableFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setSaveState("idle");
    setError(null);
    if (key === "newBrandName") setBrandCreateState("idle");
  };

  const handleCreateBrand = async () => {
    const brandName = fields.newBrandName.trim();
    if (!brandName) {
      setBrandCreateState("error");
      setError("Enter a brand name before creating a brand.");
      return;
    }

    const existingBrand = brands.find((brand) => brand.name.toLowerCase() === brandName.toLowerCase());
    if (existingBrand) {
      updateField("brandId", existingBrand.id);
      updateField("newBrandName", "");
      setBrandCreateState("created");
      return;
    }

    setBrandCreateState("creating");
    setError(null);

    const response = await fetch("/api/admin/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: brandName }),
    });

    if (!response.ok) {
      setBrandCreateState("error");
      setError("Brand creation failed. Check the brand name and try again.");
      return;
    }

    const createdBrand = await response.json() as GearBrandOption;
    onBrandCreated?.(createdBrand);
    updateField("brandId", createdBrand.id);
    updateField("newBrandName", "");
    setBrandCreateState("created");
  };

  const handleDelete = async () => {
    if (isCreateMode || !item) return;

    const confirmed = window.confirm(`Delete ${item.name} from the gear catalog? This permanently removes the item and its variants because this schema does not have an archive/status field. This cannot be undone.`);
    if (!confirmed) return;

    setDeleteState("deleting");
    setError(null);

    const response = await fetch(`/api/admin/gear/${item.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setDeleteState("error");
      setError("Delete failed. The item may already be used by related records, or the server rejected the request.");
      return;
    }

    setDeleteState("deleted");
    onDeleted?.(item.id);
  }

  const handleSave = async () => {
    if (!isCreateMode && !item) return;
    if (!fields.name.trim() || !fields.brandId.trim() || !fields.category || !fields.priceRange) {
      setSaveState("error");
      setError("Name, brand ID, category, and price range are required.");
      return;
    }
    setSaveState("saving");
    setError(null);

    const response = await fetch(isCreateMode ? "/api/admin/gear" : `/api/admin/gear/${item?.id}`, {
      method: isCreateMode ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fields.name,
        brandId: fields.brandId.trim(),
        category: fields.category,
        priceRange: fields.priceRange,
        genderTarget: fields.genderTarget.trim() || null,
        subcategory: fields.subcategory.trim() || null,
        tags,
        bodyTypeFit,
        imageUrl: imageUrl || null,
        affiliateUrl: fields.affiliateUrl.trim() || null,
        weatherSuitability: {
          hot: parseWeatherScore(fields.weatherHot),
          cold: parseWeatherScore(fields.weatherCold),
          rain: parseWeatherScore(fields.weatherRain),
          wind: parseWeatherScore(fields.weatherWind),
        },
      }),
    });

    if (!response.ok) {
      setSaveState("error");
      setError(isCreateMode ? "Create failed. Check the required fields and brand ID, then try again." : "Save failed. Check the item data and try again.");
      return;
    };

    const savedItem = await response.json() as GearEditorItem;
    const savedBrand = brands.find((brand) => brand.id === savedItem.brandId) ?? null;
    const savedItemWithBrand = savedBrand ? { ...savedItem, brand: savedBrand } : savedItem;
    setSaveState("saved");
    if (isCreateMode) {
      onCreated?.(savedItemWithBrand);
    }
  };

  if (!item && !isCreateMode) {
    return (
      <Card className="rounded-2xl border border-zinc-800/70 bg-zinc-900/60 shadow-sm">
        <CardContent className="p-5">
          <SectionHeader title="Gear Editor" description="Select a gear item to review real catalog data" badge={<EmptyBadge>Pending</EmptyBadge>} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="min-w-0 space-y-4 2xl:sticky 2xl:top-6">
      <Card className="overflow-hidden rounded-2xl border border-zinc-800/70 bg-zinc-900/60">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/60">
              {saveState === "saving" ? <Loader2 className="size-4 animate-spin text-zinc-300" /> : <Save className="size-4 text-zinc-400" />}
            </div>

            <div>
              <p className="text-sm font-medium text-zinc-100">{isCreateMode ? "Create new item" : "Manual save only"}</p>
              <p className="text-xs text-zinc-500">{isCreateMode ? "Required fields are name, brand ID, category, and price range." : "Autosave is not configured for this editor."}</p>
            </div>
          </div>

          <Badge className="border border-zinc-700 bg-zinc-950 text-zinc-400">
            {saveState === "saved" ? (isCreateMode ? "Created" : "Saved") : saveState === "saving" ? (isCreateMode ? "Creating" : "Saving") : saveState === "error" ? "Error" : isCreateMode ? "New item" : "Not synced"}
          </Badge>
        </div>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-1">
        <div className="space-y-4">
          <Card className="rounded-2xl border border-zinc-800/70 bg-zinc-900/60 shadow-sm">
            <CardContent className="space-y-6 p-5">
              <SectionHeader title="Basic Information" description="Primary product information stored on the selected catalog item." badge={<Badge className="border border-zinc-700 bg-zinc-950 text-zinc-300">{isCreateMode ? "New" : item?.id}</Badge>} />

              <div className="space-y-4">
                <div><FieldLabel label="Gear Name" hint="Required" /><Input value={fields.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Missing" className="border-zinc-700 bg-zinc-950 text-zinc-100" /></div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div><FieldLabel label="Brand" hint={selectedBrand ? `Selected: ${selectedBrand.name}` : isCreateMode ? "Required" : "Select by name"} /><select value={fields.brandId} onChange={(event) => updateField("brandId", event.target.value)} className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-0 transition focus:border-zinc-500"><option value="">Select a brand</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select><div className="mt-3 flex gap-2"><Input value={fields.newBrandName} onChange={(event) => updateField("newBrandName", event.target.value)} placeholder="New brand name" className="border-zinc-700 bg-zinc-950 text-zinc-100" /><Button type="button" variant="outline" onClick={handleCreateBrand} disabled={brandCreateState === "creating"} className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">{brandCreateState === "creating" ? "Adding…" : "Add"}</Button></div><p className="mt-2 text-[11px] text-zinc-500">Brand ID is stored automatically after selecting or creating a brand.</p></div>
                  <div><FieldLabel label="Category" /><select value={fields.category} onChange={(event) => updateField("category", event.target.value)} className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-0 transition focus:border-zinc-500">{categoryOptions.map((option) => <option key={option}>{option}</option>)}</select></div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div><FieldLabel label="Subcategory" /><Input value={fields.subcategory} onChange={(event) => updateField("subcategory", event.target.value)} placeholder="Not configured" className="border-zinc-700 bg-zinc-950 text-zinc-100" /></div>
                  <div><FieldLabel label="Price range" /><select value={fields.priceRange} onChange={(event) => updateField("priceRange", event.target.value)} className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-0 transition focus:border-zinc-500">{priceRangeOptions.map((option) => <option key={option}>{option}</option>)}</select></div>
                </div>
                <div><FieldLabel label="Description" hint="No description field exists on this item" /><textarea rows={4} value="" disabled placeholder="Missing" className="w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-3 py-3 text-sm leading-6 text-zinc-500 outline-none" /><p className="mt-2 text-[11px] text-zinc-500">Description is unavailable because the current schema does not provide one.</p></div>
              </div>
            </CardContent>
          </Card>

          <EditorSection title="Media Library" description="Shows the selected item's current imageUrl status.">
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
                  {imageUrl ? <Image src={imageUrl} alt={fields.name || "Gear item image"} width={640} height={480} className="aspect-[4/3] w-full object-cover" /> : <div className="flex aspect-[4/3] flex-col items-center justify-center bg-zinc-950 text-zinc-500"><ImageOff className="mb-2 size-8" /><span className="text-sm">No image yet</span></div>}
                  <div className="absolute left-3 top-3"><Badge className="bg-black/70 text-white backdrop-blur">Primary Image</Badge></div>
                  <div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-black/50 px-4 py-3 backdrop-blur"><p className="truncate text-sm font-medium text-white">{imageUrl || "No image yet"}</p><p className="text-xs text-zinc-300">imageUrl {imageUrl ? "configured" : "missing"}</p></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {Array.from({ length: 3 }).map((_, index) => <div key={index} className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 text-xs text-zinc-500">Pending</div>)}
                  <button type="button" disabled className="flex aspect-square flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 text-zinc-600"><ImageOff className="mb-2 size-5" /><span className="text-xs">Upload not configured</span></button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2"><Badge className={imageUrl ? "bg-emerald-500/10 text-emerald-300" : "bg-zinc-800 text-zinc-400"}>{imageUrl ? "Image URL configured" : "No image yet"}</Badge></div>
            </div>
          </EditorSection>

          {/* Recommendation preview */}
          <EditorSection title="Recommendation Notes" description="Generated recommendation previews are not implemented here.">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4"><div className="flex gap-3"><div className="mt-0.5 flex size-9 items-center justify-center rounded-full border border-violet-500/20 bg-violet-500/10"><Wand2 className="size-4 text-violet-300" /></div><div><p className="text-sm leading-relaxed text-zinc-300">Recommendation note preview is <span className="font-medium text-white">Pending</span>.</p><p className="mt-2 text-xs text-zinc-500">No refresh action or match score is configured for this editor.</p></div></div></div>
          </EditorSection>
        </div>

        <div className="space-y-4">
          <Card className="rounded-2xl border border-zinc-800/70 bg-zinc-900/60"><CardContent className="space-y-5 p-5"><SectionHeader title="Metadata Quality" description="Completeness based on actual editable fields." /><div><div className="mb-2 flex items-end justify-between"><div><p className="text-4xl font-semibold tracking-tight text-white">{completion}%</p><p className="text-xs text-zinc-500">Metadata completeness</p></div><Badge className={completion >= 80 ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}>{completion >= 80 ? "Ready" : "Pending"}</Badge></div><div className="h-2 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-zinc-100" style={{ width: `${completion}%` }} /></div></div><div className="space-y-2">{[{ label: "Required basics", complete: hasValue(fields.name) && hasValue(fields.brandId) && hasValue(fields.category) }, { label: "Tags", complete: tags.length > 0 }, { label: "Weather scores", complete: weatherComplete > 0 }, { label: "Image URL", complete: hasValue(imageUrl) }].map((check) => <div key={check.label} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2"><div className="flex items-center gap-2">{check.complete ? <Check className="size-4 text-emerald-300" /> : <AlertTriangle className="size-4 text-amber-300" />}<span className="text-sm text-zinc-300">{check.label}</span></div><span className="text-xs text-zinc-500">{check.complete ? "Configured" : "Missing"}</span></div>)}</div></CardContent></Card>

          <EditorSection title="Recommendation Metadata" description="Actual tags and metadata stored in this item">
            <div className="space-y-4">
              <div><FieldLabel label="Tags" hint="Comma-separated" /><Input value={fields.tags} onChange={(event) => updateField("tags", event.target.value)} placeholder="Missing" className="border-zinc-700 bg-zinc-950 text-zinc-100" /><div className="mt-2 flex flex-wrap gap-2">{tags.length ? tags.map((tag) => <Badge key={tag} className="border border-zinc-700 bg-zinc-900 text-zinc-300">{tag}</Badge>) : <EmptyBadge>Missing</EmptyBadge>}</div></div>
              <div><FieldLabel label="Body type fit" hint="Comma-separated" /><Input value={fields.bodyTypeFit} onChange={(event) => updateField("bodyTypeFit", event.target.value)} placeholder="Not configured" className="border-zinc-700 bg-zinc-950 text-zinc-100" /><div className="mt-2 flex flex-wrap gap-2">{bodyTypeFit.length ? bodyTypeFit.map((fit) => <Badge key={fit} className="border border-zinc-700 bg-zinc-900 text-zinc-300">{fit}</Badge>) : <EmptyBadge>Not configured</EmptyBadge>}</div></div>
            </div>
          </EditorSection>

          <EditorSection title="Weather Conditions" description="Stored weather suitability scores from 0 to 1."><div className="grid gap-4 sm:grid-cols-2">{weatherFields.map(({ key, label }) => <div key={key}><FieldLabel label={label} /><Input value={fields[key]} onChange={(event) => updateField(key, event.target.value)} placeholder="Missing" className="border-zinc-700 bg-zinc-950" /></div>)}</div></EditorSection>

          <EditorSection title="Intensity Compatibility" description="No separate intensity model exists; workout context can only be inferred from tags." defaultOpen={false}><div className="flex flex-wrap gap-2">{tags.length ? tags.map((tag) => <Badge key={tag} className="border border-zinc-700 bg-zinc-900 text-zinc-300">{tag}</Badge>) : <EmptyBadge>Not configured</EmptyBadge>}</div></EditorSection>

          <Card className="overflow-hidden rounded-2xl border border-zinc-800/70 bg-zinc-900/60 shadow-sm"><CardContent className="space-y-5 p-5"><SectionHeader title="Catalog Status" description="Track real update status and metadata readiness." /><div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4"><div className="flex items-start gap-3"><Clock3 className="mt-0.5 size-4 text-amber-300" /><div><p className="text-sm font-medium text-amber-100">{completion >= 80 ? "Metadata mostly configured" : "Needs metadata"}</p><p className="mt-1 text-xs leading-relaxed text-amber-200/70">{completion >= 80 ? "Most tracked fields are present." : "Some fields are missing or not configured."}</p></div></div></div><div className="space-y-2 text-xs text-zinc-500"><p>Last updated · {formatDate(item?.updatedAt)}</p><p>Edited by · Pending</p></div>{error ? <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p> : null}<div className="sticky bottom-0 -mx-5 -mb-5 mt-6 border-t border-zinc-800 bg-zinc-950/90 p-5 backdrop-blur-xl"><div className="flex flex-wrap gap-2"><Button variant="outline" disabled className="border-zinc-700 bg-zinc-900 text-zinc-500">Save draft unavailable</Button><Button onClick={handleSave} disabled={saveState === "saving"} className="flex-1 bg-zinc-100 text-zinc-900 hover:bg-white">{saveState === "saving" ? (isCreateMode ? "Creating…" : "Saving…") : isCreateMode ? "Create Gear" : "Save Changes"}</Button>{isCreateMode ? <Button variant="outline" disabled className="border-zinc-700 bg-zinc-900 text-zinc-500"><Trash2 className="mr-2 size-4" />Delete unavailable</Button> : <Button type="button" variant="outline" onClick={handleDelete} disabled={deleteState === "deleting" || deleteState === "deleted"} className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"><Trash2 className="mr-2 size-4" />{deleteState === "deleting" ? "Deleting…" : deleteState === "deleted" ? "Deleted" : "Delete Gear"}</Button>}</div></div></CardContent></Card>
        </div>
      </div>
    </div>
  );
}