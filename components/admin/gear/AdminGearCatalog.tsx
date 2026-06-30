"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GearEditor, type GearEditorItem } from "@/components/admin/gear/GearEditor";
import { GearFilters, type GearFilterState } from "@/components/admin/gear/GearFilters";
import { GearTable } from "@/components/admin/gear/GearTable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { ADMIN_GEAR_ADD_EVENT } from "./AdminGearActions";

type AdminGearCatalogProps = {
  items: GearEditorItem[];
};

function hasMetadataGaps(item: GearEditorItem) {
  return item.tags.length === 0 || item.bodyTypeFit.length === 0 || !item.imageUrl;
}

function matchesSearch(item: GearEditorItem, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [
    item.name,
    item.brandId,
    item.brand?.name ?? "",
    item.category,
    item.subcategory ?? "",
    ...item.tags,
    ...item.bodyTypeFit,
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

function matchesFilters(item: GearEditorItem, filters: GearFilterState) {
  if (filters.category !== "all" && item.category !== filters.category) return false;
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
    imageStatus: "all",
    metadataStatus: "all",
  });
  const router = useRouter();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(items[0]?.id ?? null);
  const [isCreating, setIsCreating] = useState(false);
  const [createdItem, setCreatedItem] = useState<GearEditorItem | null>(null);
  const catalogItems = useMemo(() => {
    if (!createdItem || items.some((item) => item.id === createdItem.id)) return items;
    return [createdItem, ...items];
  }, [createdItem, items]);

  const filteredItems = useMemo(
    () => catalogItems.filter((item) => matchesFilters(item, filters)),
    [catalogItems, filters],
  );

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

  return (
    <>
      <GearFilters filters={filters} items={catalogItems} resultCount={filteredItems.length} onFiltersChange={setFilters} />

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
        <GearEditor key={isCreating ? "new" : selectedItem?.id ?? "empty"} item={selectedItem} mode={isCreating ? "create" : "edit"} onCreated={handleCreated} />
      </section>
    </>
  );
}