"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GearEditor, type GearBrandOption,type GearEditorItem } from "@/components/admin/gear/GearEditor";
import { GearFilters, type GearFilterState } from "@/components/admin/gear/GearFilters";
import { GearTable } from "@/components/admin/gear/GearTable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { ADMIN_GEAR_ADD_EVENT } from "./AdminGearActions";

type AdminGearCatalogProps = {
  items: GearEditorItem[];
};

function hasMetadataGaps(item: GearEditorItem) {
  const hasWeatherMetadata = [item.weatherHot, item.weatherCold, item.weatherRain, item.weatherWind].some((value) => typeof value === "number");
  return item.tags.length === 0 || item.bodyTypeFit.length === 0 || !item.imageUrl || !item.genderTarget || !item.subcategory || !hasWeatherMetadata;
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
  const catalogItems = useMemo(() => {
    const activeItems = items.filter((item) => !deletedItemIds.has(item.id));
    if (!createdItem || activeItems.some((item) => item.id === createdItem.id) || deletedItemIds.has(createdItem.id)) return activeItems;
    return [createdItem, ...activeItems];
  }, [createdItem, deletedItemIds, items]);

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
      setIsCreating(true);
      setSelectedItemId(null);
    };

    window.addEventListener(ADMIN_GEAR_ADD_EVENT, handleAddGear);
    return () => window.removeEventListener(ADMIN_GEAR_ADD_EVENT, handleAddGear);
  }, []);

  const selectedItem = isCreating ? null : catalogItems.find((item) => item.id === selectedItemId) ?? filteredItems[0] ?? catalogItems[0] ?? null;

  const handleSelectItem = (itemId: string) => {
    setIsCreating(false);
    setSelectedItemId(itemId);
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
        <GearEditor key={isCreating ? "new" : selectedItem?.id ?? "empty"} item={selectedItem} mode={isCreating ? "create" : "edit"} onCreated={handleCreated} onDeleted={handleDeleted} brands={brands} onBrandCreated={handleBrandCreated} />
      </section>
    </>
  );
}