"use client";


import { useEffect, useId, useReducer, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Clock3, ExternalLink, ImageOff, Loader2, Save, Trash2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import {
  categoryOptions,
  formatDate,
  genderTargetOptions,
  hasValue,
  isValidHttpUrl,
  parseWeatherScore,
  priceRangeOptions,
  splitList,
  weatherFields,
  type EditableFields,
  type GearEditorItem,
} from "./gearEditorModel";
import { createEditorController, type EditorController } from "./gearEditorController";
import { GearEditorNotices } from "./GearEditorNotices";
import { canSave, createEditorState, editorReducer, isDirty, isLocked, liveMessage, statusBadgeLabel } from "./gearEditorState";
import type { SavedItem } from "./gearEditorRequests";
import { chooseFocusTarget, focusWasLost, pickFocusTarget, type FocusTarget } from "./gearEditorFocus";

export type { GearEditorItem } from "./gearEditorModel";

export type GearBrandOption = {
  id: string;
  name: string;
};

type GearEditorProps = {
  item?: GearEditorItem | null;
  mode?: "edit" | "create";
  onCreated?: (item: GearEditorItem) => void;
  /** A save of `itemId` succeeded; `saved` is the validated PATCH response (scalar columns only, no brand or variants). */
  onSaved?: (itemId: string, saved: SavedItem) => void;
  /** The latest server copy of `itemId` was read by "Load latest" or "Check latest". */
  onReloaded?: (itemId: string, item: GearEditorItem) => void;
  /** Reports whether the draft has unsaved changes, so the catalog can confirm before switching away. */
  onDirtyChange?: (dirty: boolean) => void;
  onDeleted?: (itemId: string) => void;
  brands?: GearBrandOption[];
  onBrandCreated?: (brand: GearBrandOption) => void;
};

type DeleteState = "idle" | "deleting" | "deleted" | "error";
type BrandCreateState = "idle" | "creating" | "created" | "error";

function SectionHeader({
  title,
  description,
  badge,
}: {
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
  headingId,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Lets content inside the section name itself after the heading (aria-labelledby). */
  headingId?: string;
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
          <h3 id={headingId} className="text-sm font-semibold text-zinc-100">{title}</h3>

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
  htmlFor,
  hintId,
} : {
  label: string;
  hint?: string;
  /** The id of the control this label names. */
  htmlFor: string;
  /** The id given to the hint, so the control can reference it with aria-describedby. */
  hintId?: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <label htmlFor={htmlFor} className="text-xs font-medium text-zinc-300">{label}</label>

      {hint ? (
        <span id={hintId} className="text-[11px] text-zinc-500">{hint}</span>
      ) : null}
    </div>
  );
}

function EmptyBadge({ children = "Missing" }: { children?: React.ReactNode }) {
  return <Badge className="border border-zinc-700 bg-zinc-900 text-zinc-400">{children}</Badge>
}

export function GearEditor({ item, mode = "edit", onCreated, onSaved, onReloaded, onDirtyChange, onDeleted, brands = [], onBrandCreated }: GearEditorProps) {
  // All draft, baseline-version, save and conflict state lives in one reducer (gearEditorState.ts). The baseline version is captured from the
  // item ONCE, here, together with the fields; later changes to the `item` prop (for example a catalog refresh) never touch the draft or the token.
  const [state, dispatch] = useReducer(editorReducer, undefined, () => createEditorState(item, mode));
  const fields = state.draft;
  // Control ids are derived from one useId() per editor instance, so they are unique even if several editors render on one page.
  const uid = useId();
  const fid = (key: string) => `${uid}-${key}`;
  const [deleteState, setDeleteState] = useState<DeleteState>("idle");
  const [brandCreateState, setBrandCreateState] = useState<BrandCreateState>("idle");

  const isCreateMode = mode === "create";

  // Refs hold the latest state and callbacks for the controller's async work; they are only read inside event handlers, never during render.
  const stateRef = useRef(state);
  const callbacksRef = useRef({ brands, onSaved, onReloaded, onCreated });
  const dirtyCallbackRef = useRef(onDirtyChange);
  useEffect(() => {
    stateRef.current = state;
    callbacksRef.current = { brands, onSaved, onReloaded, onCreated };
    dirtyCallbackRef.current = onDirtyChange;
  });
  // The controller is created on first use, inside an event handler (never during render), so it can safely read the refs above.
  const controllerRef = useRef<EditorController | null>(null);
  const getController = () => {
    if (!controllerRef.current) {
      controllerRef.current = createEditorController({
        getState: () => stateRef.current,
        dispatch,
        fetchImpl: (input, init) => fetch(input, init),
        confirm: (message) => window.confirm(message),
        callbacks: () => callbacksRef.current,
      });
    }
    return controllerRef.current;
  };

  // Focus restoration (see gearEditorFocus.ts). It runs only after a state TRANSITION that needs it, so it never fires on mount or while typing,
  // and it only acts when focus was actually lost, so it never takes focus from a control the user chose.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const previousStateRef = useRef(state);
  useEffect(() => {
    const previous = previousStateRef.current;
    previousStateRef.current = state;
    const candidates = chooseFocusTarget(previous, state);
    const root = rootRef.current;
    if (!candidates || !root) return;
    const active = document.activeElement;
    // Any enabled, attached control that has focus (in this editor or anywhere else on the page) keeps it.
    if (!focusWasLost(active ? { tagName: active.tagName, isConnected: active.isConnected, disabled: active.matches(":disabled") } : null)) return;
    const target = pickFocusTarget(candidates, (name: FocusTarget) => {
      const element = root.querySelector<HTMLElement>(`[data-focus="${name}"]`);
      return element ? { isConnected: element.isConnected, disabled: element.matches(":disabled"), element } : null;
    });
    target?.element.focus();
  }, [state]);

  const dirty = isDirty(state);
  useEffect(() => { dirtyCallbackRef.current?.(dirty); }, [dirty]);
  useEffect(() => {
    const report = dirtyCallbackRef;
    return () => report.current?.(false);
  }, []);

  const imageUrl = fields.imageUrl.trim();
  const affiliateUrl = fields.affiliateUrl.trim();
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
    affiliateUrl,
    tags.length ? "tags" : "",
    bodyTypeFit.length ? "bodyTypeFit" : "",
    ...weatherValues.map((value) => value === null ? "" : String(value)),
  ].filter((value) => hasValue(String(value))).length;
  const totalFields = 14;
  const completion = Math.round((completedFields / totalFields) * 100);
  const weatherComplete = weatherValues.filter((value) => value !== null).length;
  const selectedBrand = brands.find((brand) => brand.id === fields.brandId) ?? null;
  const hasPreviewableImageUrl = isValidHttpUrl(imageUrl);
  const hasInvalidImageUrl = hasValue(imageUrl) && !hasPreviewableImageUrl;
  const hasAffiliateUrl = hasValue(affiliateUrl);
  const hasInvalidAffiliateUrl = hasAffiliateUrl && !isValidHttpUrl(affiliateUrl);

  const updateField = (key: keyof EditableFields, value: string) => {
    dispatch({ type: "edit", key, value });
    if (key === "newBrandName") setBrandCreateState("idle");
  };

  const handleCreateBrand = async () => {
    const brandName = fields.newBrandName.trim();
    if (!brandName) {
      setBrandCreateState("error");
      dispatch({ type: "localInvalid", message: "Enter a brand name before creating a brand." });
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

    const response = await fetch("/api/admin/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: brandName }),
    });

    if (!response.ok) {
      setBrandCreateState("error");
      dispatch({ type: "localInvalid", message: "Brand creation failed. Check the brand name and try again." });
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

    const response = await fetch(`/api/admin/gear/${item.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setDeleteState("error");
      dispatch({ type: "localInvalid", message: "Delete failed. The item may already be used by related records, or the server rejected the request." });
      return;
    }

    setDeleteState("deleted");
    onDeleted?.(item.id);
  }

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
    <div ref={rootRef} className="min-w-0 space-y-4 2xl:sticky 2xl:top-6">
      <Card className="overflow-hidden rounded-2xl border border-zinc-800/70 bg-zinc-900/60">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/60">
              {state.status === "saving" || state.status === "reloading" ? <Loader2 className="size-4 animate-spin text-zinc-300" /> : <Save className="size-4 text-zinc-400" />}
            </div>

            <div>
              <p className="text-sm font-medium text-zinc-100">{isCreateMode ? "Create new item" : "Manual save only"}</p>
              <p className="text-xs text-zinc-500">{isCreateMode ? "Required fields are name, brand ID, category, and price range." : "Autosave is not configured for this editor."}</p>
            </div>
          </div>

          <Badge className="border border-zinc-700 bg-zinc-950 text-zinc-400">
            {statusBadgeLabel(state)}
          </Badge>
        </div>
      </Card>

      {/* Politely announces save progress and results. Errors and conflicts announce themselves through their own role="alert" notices. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveMessage(state)}</p>

      {/* While a request is in flight every control is disabled, so the draft can not change under it (and a reload can never overwrite later edits). */}
      <fieldset disabled={isLocked(state)} className="m-0 min-w-0 border-0 p-0">
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-1">
        <div className="space-y-4">
          <Card className="rounded-2xl border border-zinc-800/70 bg-zinc-900/60 shadow-sm">
            <CardContent className="space-y-6 p-5">
              <SectionHeader title="Basic Information" description="Primary product information stored on the selected catalog item." badge={<Badge className="border border-zinc-700 bg-zinc-950 text-zinc-300">{isCreateMode ? "New" : item?.id}</Badge>} />

              <div className="space-y-4">
                <div><FieldLabel label="Gear Name" hint="Required" htmlFor={fid("name")} hintId={fid("name-hint")} /><Input id={fid("name")} data-focus="first-field" aria-describedby={fid("name-hint")} value={fields.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Missing" className="border-zinc-700 bg-zinc-950 text-zinc-100" /></div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div><FieldLabel label="Brand" hint={selectedBrand ? `Selected: ${selectedBrand.name}` : isCreateMode ? "Required" : "Select by name"} htmlFor={fid("brand")} hintId={fid("brand-hint")} /><select id={fid("brand")} aria-describedby={fid("brand-hint")} value={fields.brandId} onChange={(event) => updateField("brandId", event.target.value)} className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-0 transition focus:border-zinc-500"><option value="">Select a brand</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select><div className="mt-3 flex gap-2"><Input id={fid("new-brand")} aria-label="New brand name" aria-describedby={fid("brand-help")} value={fields.newBrandName} onChange={(event) => updateField("newBrandName", event.target.value)} placeholder="New brand name" className="border-zinc-700 bg-zinc-950 text-zinc-100" /><Button type="button" variant="outline" onClick={handleCreateBrand} disabled={brandCreateState === "creating"} className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">{brandCreateState === "creating" ? "Adding…" : "Add"}</Button></div><p id={fid("brand-help")} className="mt-2 text-[11px] text-zinc-500">Brand ID is stored automatically after selecting or creating a brand.</p></div>
                  <div><FieldLabel label="Category" htmlFor={fid("category")} /><select id={fid("category")} value={fields.category} onChange={(event) => updateField("category", event.target.value)} className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-0 transition focus:border-zinc-500">{categoryOptions.map((option) => <option key={option}>{option}</option>)}</select></div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div><FieldLabel label="Subcategory" htmlFor={fid("subcategory")} /><Input id={fid("subcategory")} value={fields.subcategory} onChange={(event) => updateField("subcategory", event.target.value)} placeholder="Not configured" className="border-zinc-700 bg-zinc-950 text-zinc-100" /></div>
                  <div><FieldLabel label="Price range" htmlFor={fid("price-range")} /><select id={fid("price-range")} value={fields.priceRange} onChange={(event) => updateField("priceRange", event.target.value)} className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-0 transition focus:border-zinc-500">{priceRangeOptions.map((option) => <option key={option}>{option}</option>)}</select></div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div><FieldLabel label="Gender" htmlFor={fid("gender")} /><select id={fid("gender")} aria-describedby={fid("gender-help")} value={fields.genderTarget} onChange={(event) => updateField("genderTarget", event.target.value)} className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-0 transition focus:border-zinc-500"><option value="">Not configured</option>{genderTargetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><p id={fid("gender-help")} className="mt-2 text-[11px] text-zinc-500">Leave blank to preserve items without a gender target.</p></div>
                </div>
                <div><FieldLabel label="Description" hint="No description field exists on this item" htmlFor={fid("description")} hintId={fid("description-hint")} /><textarea id={fid("description")} aria-describedby={`${fid("description-hint")} ${fid("description-help")}`} rows={4} value="" disabled placeholder="Missing" className="w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-3 py-3 text-sm leading-6 text-zinc-500 outline-none" /><p id={fid("description-help")} className="mt-2 text-[11px] text-zinc-500">Description is unavailable because the current schema does not provide one.</p></div>
              </div>
            </CardContent>
          </Card>

          <EditorSection title="Product Links" description="Store optional shopper-facing URLs for the catalog item.">
            <div className="space-y-4">
              <div><FieldLabel label="Primary image URL" hint="Optional http(s) URL" htmlFor={fid("image-url")} hintId={fid("image-url-hint")} /><Input id={fid("image-url")} aria-describedby={hasInvalidImageUrl ? `${fid("image-url-hint")} ${fid("image-url-error")}` : fid("image-url-hint")} aria-invalid={hasInvalidImageUrl || undefined} value={fields.imageUrl} onChange={(event) => updateField("imageUrl", event.target.value)} placeholder="https://example.com/image.jpg" className="border-zinc-700 bg-zinc-950 text-zinc-100" />{hasInvalidImageUrl ? <p id={fid("image-url-error")} className="mt-2 text-xs text-rose-300">Enter a valid http or https URL before saving.</p> : null}</div>
              <div className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
                {hasPreviewableImageUrl ? (
                  <div
                    role="img"
                    aria-label={fields.name || "Gear item image"}
                    className="aspect-[4/3] w-full bg-cover bg-center"
                    style={{ backgroundImage: `url(${imageUrl})` }}
                  />
                ) : (
                  <div className="flex aspect-[4/3] flex-col items-center justify-center bg-zinc-950 text-zinc-500">
                    <ImageOff className="mb-2 size-8" />
                    <span className="text-sm">
                      {imageUrl ? "Invalid image URL" : "No image yet"}
                    </span>
                  </div>
                )}
                <div className="absolute left-3 top-3">
                  <Badge className="bg-black/70 text-white backdrop-blur">
                    Primary Image
                  </Badge>
                </div>
                <div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-black/50 px-4 py-3 backdrop-blur">
                  <p className="truncate text-sm font-medium text-white">
                    {imageUrl || "No image yet"}
                  </p>
                  <p className="text-xs text-zinc-300">
                    imageUrl{" "}
                    {hasPreviewableImageUrl
                      ? "configured"
                      : imageUrl
                        ? "invalid"
                        : "missing"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className={
                    hasPreviewableImageUrl
                      ? "bg-emerald-500/10 text-emerald-300"
                      : imageUrl
                        ? "bg-rose-500/10 text-rose-300"
                        : "bg-zinc-800 text-zinc-400"
                  }
                >
                  {hasPreviewableImageUrl
                    ? "Image URL configured"
                    : imageUrl
                      ? "Invalid image URL"
                      : "No image yet"}
                </Badge>
                <Button
                  type="button"
                  disabled
                  variant="outline"
                  className="border-zinc-700 bg-zinc-900 text-zinc-500"
                >
                  Upload not configured
                </Button>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <FieldLabel
                      label="Affiliate URL"
                      hint="Optional http(s) URL"
                      htmlFor={fid("affiliate-url")}
                      hintId={fid("affiliate-url-hint")}
                    />
                    <Input
                      id={fid("affiliate-url")}
                      aria-describedby={`${fid("affiliate-url-hint")} ${fid("affiliate-url-help")}`}
                      aria-invalid={hasInvalidAffiliateUrl || undefined}
                      value={fields.affiliateUrl}
                      onChange={(event) =>
                        updateField("affiliateUrl", event.target.value)
                      }
                      placeholder="https://example.com/product"
                      className="border-zinc-700 bg-zinc-950 text-zinc-100"
                    />
                    {hasInvalidAffiliateUrl ? (
                      <p id={fid("affiliate-url-help")} className="mt-2 text-xs text-rose-300">
                        Enter a valid URL beginning with http:// or https://
                        before saving.
                      </p>
                    ) : (
                      <p id={fid("affiliate-url-help")} className="mt-2 text-[11px] text-zinc-500">
                        Leave blank to store no affiliate link for this item.
                      </p>
                    )}
                  </div>
                  {hasAffiliateUrl && !hasInvalidAffiliateUrl ? (
                    <Button
                      asChild
                      type="button"
                      variant="outline"
                      className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                    >
                      <a href={affiliateUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-4" /> Open affiliate link
                      </a>
                    </Button>
                  ) : null}
                </div>
                <div className="mt-3">
                  <Badge
                    className={
                      hasAffiliateUrl && !hasInvalidAffiliateUrl
                        ? "bg-emerald-500/10 text-emerald-300"
                        : hasInvalidAffiliateUrl
                          ? "bg-rose-500/10 text-rose-300"
                          : "bg-zinc-800 text-zinc-400"
                    }
                  >
                    {hasAffiliateUrl && !hasInvalidAffiliateUrl
                      ? "Affiliate link configured"
                      : hasInvalidAffiliateUrl
                        ? "Invalid affiliate URL"
                        : "No affiliate link"}
                  </Badge>
                </div>
              </div>
            </div>
          </EditorSection>

          {/* Recommendation preview */}
          <EditorSection title="Recommendation Notes" description="Generated recommendation previews are not implemented here.">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4"><div className="flex gap-3"><div className="mt-0.5 flex size-9 items-center justify-center rounded-full border border-violet-500/20 bg-violet-500/10"><Wand2 className="size-4 text-violet-300" /></div><div><p className="text-sm leading-relaxed text-zinc-300">Recommendation note preview is <span className="font-medium text-white">Pending</span>.</p><p className="mt-2 text-xs text-zinc-500">No refresh action or match score is configured for this editor.</p></div></div></div>
          </EditorSection>
        </div>

        <div className="space-y-4">
          <Card className="rounded-2xl border border-zinc-800/70 bg-zinc-900/60">
            <CardContent className="space-y-5 p-5">
              <SectionHeader
                title="Metadata Quality"
                description="Completeness based on actual editable fields."
              />
              <div>
                <div className="mb-2 flex items-end justify-between">
                  <div>
                    <p className="text-4xl font-semibold tracking-tight text-white">
                      {completion}%
                    </p>
                    <p className="text-xs text-zinc-500">
                      Metadata completeness
                    </p>
                  </div>
                  <Badge
                    className={
                      completion >= 80
                        ? "bg-emerald-500/10 text-emerald-300"
                        : "bg-amber-500/10 text-amber-300"
                    }
                  >
                    {completion >= 80 ? "Ready" : "Pending"}
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
                {[
                  {
                    label: "Required basics",
                    complete:
                      hasValue(fields.name) &&
                      hasValue(fields.brandId) &&
                      hasValue(fields.category),
                  },
                  { label: "Gender", complete: hasValue(fields.genderTarget) },
                  { label: "Tags", complete: tags.length > 0 },
                  { label: "Weather scores", complete: weatherComplete > 0 },
                  { label: "Image URL", complete: hasValue(imageUrl) },
                  {
                    label: "Affiliate URL",
                    complete: hasAffiliateUrl && !hasInvalidAffiliateUrl,
                  },
                ].map((check) => (
                  <div
                    key={check.label}
                    className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      {check.complete ? (
                        <Check className="size-4 text-emerald-300" />
                      ) : (
                        <AlertTriangle className="size-4 text-amber-300" />
                      )}
                      <span className="text-sm text-zinc-300">
                        {check.label}
                      </span>
                    </div>
                    <span className="text-xs text-zinc-500">
                      {check.complete ? "Configured" : "Missing"}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <EditorSection title="Recommendation Metadata" description="Actual tags and metadata stored in this item">
            <div className="space-y-4">
              <div><FieldLabel label="Tags" hint="Comma-separated" htmlFor={fid("tags")} hintId={fid("tags-hint")} /><Input id={fid("tags")} aria-describedby={fid("tags-hint")} value={fields.tags} onChange={(event) => updateField("tags", event.target.value)} placeholder="Missing" className="border-zinc-700 bg-zinc-950 text-zinc-100" /><div className="mt-2 flex flex-wrap gap-2">{tags.length ? tags.map((tag) => <Badge key={tag} className="border border-zinc-700 bg-zinc-900 text-zinc-300">{tag}</Badge>) : <EmptyBadge>Missing</EmptyBadge>}</div></div>
              <div><FieldLabel label="Body type fit" hint="Comma-separated" htmlFor={fid("body-type-fit")} hintId={fid("body-type-fit-hint")} /><Input id={fid("body-type-fit")} aria-describedby={fid("body-type-fit-hint")} value={fields.bodyTypeFit} onChange={(event) => updateField("bodyTypeFit", event.target.value)} placeholder="Not configured" className="border-zinc-700 bg-zinc-950 text-zinc-100" /><div className="mt-2 flex flex-wrap gap-2">{bodyTypeFit.length ? bodyTypeFit.map((fit) => <Badge key={fit} className="border border-zinc-700 bg-zinc-900 text-zinc-300">{fit}</Badge>) : <EmptyBadge>Not configured</EmptyBadge>}</div></div>
            </div>
          </EditorSection>

          <EditorSection title="Weather Conditions" headingId={fid("weather-heading")} description="Stored weather suitability scores from 0 to 1."><div role="group" aria-labelledby={fid("weather-heading")} className="grid gap-4 sm:grid-cols-2">{weatherFields.map(({ key, label }) => <div key={key}><FieldLabel label={label} htmlFor={fid(key)} /><Input id={fid(key)} value={fields[key]} onChange={(event) => updateField(key, event.target.value)} placeholder="Missing" className="border-zinc-700 bg-zinc-950" /></div>)}</div></EditorSection>

          <EditorSection title="Intensity Compatibility" description="No separate intensity model exists; workout context can only be inferred from tags." defaultOpen={false}><div className="flex flex-wrap gap-2">{tags.length ? tags.map((tag) => <Badge key={tag} className="border border-zinc-700 bg-zinc-900 text-zinc-300">{tag}</Badge>) : <EmptyBadge>Not configured</EmptyBadge>}</div></EditorSection>

          <Card className="overflow-hidden rounded-2xl border border-zinc-800/70 bg-zinc-900/60 shadow-sm"><CardContent className="space-y-5 p-5"><SectionHeader title="Catalog Status" description="Track real update status and metadata readiness." /><div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4"><div className="flex items-start gap-3"><Clock3 className="mt-0.5 size-4 text-amber-300" /><div><p className="text-sm font-medium text-amber-100">{completion >= 80 ? "Metadata mostly configured" : "Needs metadata"}</p><p className="mt-1 text-xs leading-relaxed text-amber-200/70">{completion >= 80 ? "Most tracked fields are present." : "Some fields are missing or not configured."}</p></div></div></div><div className="space-y-2 text-xs text-zinc-500"><p>Last updated · {formatDate(state.updatedAt)}</p><p>Edited by · Pending</p></div><GearEditorNotices state={state} onKeepEditing={() => dispatch({ type: "keepEditing" })} onLoadLatest={() => void getController().loadLatest("reload")} onRetry={() => void getController().retrySame()} onCheckLatest={() => void getController().loadLatest("check")} /><div className="sticky bottom-0 -mx-5 -mb-5 mt-6 border-t border-zinc-800 bg-zinc-950/90 p-5 backdrop-blur-xl"><div className="flex flex-wrap gap-2"><Button variant="outline" disabled className="border-zinc-700 bg-zinc-900 text-zinc-500">Save draft unavailable</Button><Button data-focus="save" onClick={() => void getController().save()} disabled={!canSave(state)} aria-busy={state.status === "saving"} className="flex-1 bg-zinc-100 text-zinc-900 hover:bg-white">{state.status === "saving" ? (isCreateMode ? "Creating…" : "Saving…") : isCreateMode ? "Create Gear" : "Save Changes"}</Button>{isCreateMode ? <Button variant="outline" disabled className="border-zinc-700 bg-zinc-900 text-zinc-500"><Trash2 className="mr-2 size-4" />Delete unavailable</Button> : <Button type="button" variant="outline" onClick={handleDelete} disabled={deleteState === "deleting" || deleteState === "deleted"} className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"><Trash2 className="mr-2 size-4" />{deleteState === "deleting" ? "Deleting…" : deleteState === "deleted" ? "Deleted" : "Delete Gear"}</Button>}</div></div></CardContent></Card>
        </div>
      </div>
      </fieldset>
    </div>
  );
}