"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GearEditor, type GearBrandOption,type GearEditorItem } from "@/components/admin/gear/GearEditor";
import { applyOverrides, decideAddGear, decideSelect, mergeSavedGearItem, resolveSelectedItem, shouldAdoptLatest } from "@/components/admin/gear/gearEditorModel";
import type { SavedItem } from "@/components/admin/gear/gearEditorRequests";
import { GearFilters, type GearFilterState } from "@/components/admin/gear/GearFilters";
import { GearTable } from "@/components/admin/gear/GearTable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { ADMIN_GEAR_ADD_EVENT } from "./AdminGearActions";

type AdminGearCatalogProps = {
  items: GearEditorItem[];
};

function hasMetadataGaps(item: GearEditorItem) {
  const hasWeatherMetadata = [item.weatherHot, item.weatherCold, item.weatherRain, item.weatherWind].some((value) => typeof value === "number");
  return item.tags.length === 0 || item.bodyTypeFit.length === 0 || !item.imageUrl || !item.affiliateUrl || !item.genderTarget || !item.subcategory || !hasWeatherMetadata;
}

function matchesSearch(item: GearEditorItem, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [
    item.name,
    item.brandId,
    item.brand?.name ?? "",
    item.category,
    item.genderTarget ?? "",
    item.subcategory ?? "",
    item.affiliateUrl ?? "",
    ...item.tags,
    ...item.bodyTypeFit,
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

function matchesFilters(item: GearEditorItem, filters: GearFilterState) {
  if (filters.category !== "all" && item.category !== filters.category) return false;
  if (filters.priceRange !== "all" && item.priceRange !== filters.priceRange) return false;
  if (filters.brandId !== "all" && item.brandId !== filters.brandId) return false;
  if (filters.imageStatus === "with-image" && !item.imageUrl) return false;
  if (filters.imageStatus === "missing-image" && item.imageUrl) return false;
  if (filters.metadataStatus === "needs-metadata" && !hasMetadataGaps(item)) return false;
  if (filters.metadataStatus === "complete" && hasMetadataGaps(item)) return false;
  return matchesSearch(item, filters.searchQuery);
}

export function AdminGearCatalog({ items }: AdminGearCatalogProps) {
  const [filters, setFilters] = useState<GearFilterState>({
    searchQuery: "",
    category: "all",
    priceRange: "all",
    brandId: "all",
    imageStatus: "all",
    metadataStatus: "all",
  });
  const router = useRouter();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(items[0]?.id ?? null);
  const [isCreating, setIsCreating] = useState(false);
  const [createdItem, setCreatedItem] = useState<GearEditorItem | null>(null);
  const [brands, setBrands] = useState<GearBrandOption[]>([]);
  const [deletedItemIds, setDeletedItemIds] = useState<Set<string>>(() => new Set());
  // Locally known newer copies of items, keyed by id: a saved item merged into its entry, or the latest server copy after "Load latest".
  // An override is used only while its version is newer than the server item's, so a refresh can never be masked by it (applyOverrides).
  const [overrides, setOverrides] = useState<Map<string, GearEditorItem>>(() => new Map());
  // Whether the open editor has unsaved changes. A ref, because it is only read inside event handlers.
  const editorDirtyRef = useRef(false);
  const handleDirtyChange = useCallback((dirty: boolean) => { editorDirtyRef.current = dirty; }, []);
  const catalogItems = useMemo(() => {
    const activeItems = applyOverrides(items, overrides).filter((item) => !deletedItemIds.has(item.id));
    if (!createdItem || activeItems.some((item) => item.id === createdItem.id) || deletedItemIds.has(createdItem.id)) return activeItems;
    return [createdItem, ...activeItems];
  }, [createdItem, deletedItemIds, items, overrides]);

  const filteredItems = useMemo(
    () => catalogItems.filter((item) => matchesFilters(item, filters)),
    [catalogItems, filters],
  );

  useEffect(() => {
    let ignore = false;

    async function loadBrands() {
      const response = await fetch("/api/admin/brands");
      if (!response.ok || ignore) return;
      const loadedBrands = await response.json() as GearBrandOption[];
      setBrands(loadedBrands);
    }

    void loadBrands();

    return () => {
      ignore = true;
    }
  }, []);

  useEffect(() => {
    const handleAddGear = () => {
      if (decideAddGear({ dirty: editorDirtyRef.current, confirm: (message) => window.confirm(message) }) !== "switch") return;
      setIsCreating(true);
      setSelectedItemId(null);
    };

    window.addEventListener(ADMIN_GEAR_ADD_EVENT, handleAddGear);
    return () => window.removeEventListener(ADMIN_GEAR_ADD_EVENT, handleAddGear);
  }, []);

  const selectedItem = resolveSelectedItem({ isCreating, selectedItemId, catalogItems, filteredItems });

  const handleSelectItem = (itemId: string) => {
    // Re-selecting the open item is not a switch; otherwise a dirty editor must be confirmed first. Declining leaves the selection (and the
    // draft) exactly as it was. See decideSelect.
    const decision = decideSelect(itemId, { isCreating, selectedId: selectedItem?.id ?? null, dirty: editorDirtyRef.current, confirm: (message) => window.confirm(message) });
    if (decision !== "switch") return;
    setIsCreating(false);
    setSelectedItemId(itemId);
  };

  // A save of `itemId` succeeded. The PATCH response has no brand or variants, so it is merged into the entry with the SAME id (never into
  // "the selected item"), keeping the entry's relations. A response that is not newer than the entry is ignored (mergeSavedGearItem).
  const handleSaved = (itemId: string, saved: SavedItem) => {
    const base = catalogItems.find((candidate) => candidate.id === itemId);
    if (base) {
      const merged = mergeSavedGearItem(base, saved, brands);
      if (merged !== base) setOverrides((current) => new Map(current).set(itemId, merged));
    }
    setCreatedItem((current) => (current && current.id === itemId ? mergeSavedGearItem(current, saved, brands) : current));
  };

  // The latest server copy of `itemId` was read: it replaces what this catalog knows about that item (matched by id), unless it is OLDER than
  // what is already known (a late response from an earlier request).
  const handleReloaded = (itemId: string, latest: GearEditorItem) => {
    if (latest.id !== itemId) return;
    if (!shouldAdoptLatest(catalogItems.find((candidate) => candidate.id === itemId), latest)) return;
    setOverrides((current) => (shouldAdoptLatest(current.get(itemId), latest) ? new Map(current).set(itemId, latest) : current));
    setCreatedItem((current) => (current && current.id === itemId && shouldAdoptLatest(current, latest) ? latest : current));
  };

  const handleCreated = (created: GearEditorItem) => {
    setCreatedItem(created);
    setIsCreating(false);
    setSelectedItemId(created.id);
    router.refresh();
  };

  const handleBrandCreated = (brand: GearBrandOption) => {
    setBrands((current) => current.some((item) => item.id === brand.id) ? current : [...current, brand].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const handleDeleted = (deletedId: string) => {
    setDeletedItemIds((current) => new Set(current).add(deletedId));
    setCreatedItem((current) => current?.id === deletedId ? null : current);
    setSelectedItemId((current) => current === deletedId ? null : current);
    setIsCreating(false);
    router.refresh();
  };

  return (
    <>
      <GearFilters filters={filters} items={catalogItems} brands={brands} resultCount={filteredItems.length} onFiltersChange={setFilters} />

      <section className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="min-w-0 rounded-2xl border-zinc-800/70 bg-zinc-900/60">
          <CardHeader className="border-b border-zinc-800/80">
            <CardTitle className="text-lg">Catalog items</CardTitle>
            <CardDescription className="text-zinc-400">Review gear details, metadata coverage, and update status.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <GearTable items={filteredItems} onSelectItem={handleSelectItem} />
          </CardContent>
        </Card>
        <GearEditor key={isCreating ? "new" : selectedItem?.id ?? "empty"} item={selectedItem} mode={isCreating ? "create" : "edit"} onCreated={handleCreated} onSaved={handleSaved} onReloaded={handleReloaded} onDirtyChange={handleDirtyChange} onDeleted={handleDeleted} brands={brands} onBrandCreated={handleBrandCreated} />
      </section>
    </>
  );
}