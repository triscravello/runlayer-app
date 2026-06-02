"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import type { SavedKitType, SavedOutfit, UpdateSavedOutfitInput } from "@/services/savedOutfitService";

export type SavedKitEditorProps = {
    kit: SavedOutfit;
    userId: string;
    onCancel: () => void;
    onSave: (input: UpdateSavedOutfitInput) => Promise<SavedOutfit | null>;
};

const selectClassName = "border-input bg-input-background focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border px-3 py-1 text-base outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

function getPersistedGearIds(kit: SavedOutfit) {
    return (Array.isArray(kit.OutfitItem) ? kit.OutfitItem : []).flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const gearItem = "gearItem" in entry ? entry.gearItem : null;
        if (typeof gearItem !== "object" || gearItem === null || !("id" in gearItem)) return [];
        return typeof gearItem.id === "string" ? [gearItem.id] : [];
    });
}

export function SavedKitEditor({ kit, userId, onCancel, onSave }: SavedKitEditorProps) {
    const initialGearIds = useMemo(() => getPersistedGearIds(kit).join(", "), [kit]);
    const [name, setName] = useState(kit.name ?? "");
    const [description, setDescription] = useState(kit.description ?? "");
    const [type, setType] = useState<SavedKitType>(kit.type ?? "custom");
    const [gearIds, setGearIds] = useState(initialGearIds);
    const [saving, setSaving] = useState(false);

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSaving(true);
        const saved = await onSave({
            userId,
            outfitId: kit.id,
            name,
            description,
            type,
            gearItemIds: gearIds.split(",").map((id) => id.trim()).filter(Boolean),
        });
        setSaving(false);
        if (saved) onCancel();
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border bg-white p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor={`kit-name-${kit.id}`}>Kit name</Label>
                    <Input id={`kit-name-${kit.id}`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Marathon Build Kit" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor={`kit-type-${kit.id}`}>Kit type</Label>
                    <select id={`kit-type-${kit.id}`} className={selectClassName} value={type} onChange={(event) => setType(event.target.value as SavedKitType)}>
                        <option value="race_day">Race day</option>
                        <option value="training">Training</option>
                        <option value="custom">Custom</option>
                    </select>
                </div>
                <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={`kit-description-${kit.id}`}>Description</Label>
                    <Input id={`kit-description-${kit.id}`} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Rain-ready long run setup" />
                </div>
                <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={`kit-gear-${kit.id}`}>Gear item IDs</Label>
                    <Input id={`kit-gear-${kit.id}`} value={gearIds} onChange={(event) => setGearIds(event.target.value)} placeholder="Comma-separated gear ids" />
                    <p className="text-xs text-muted-foreground">Add or remove persisted gear by editing comma-separated gear IDs.</p>
                </div>
            </div>
            <div className="flex gap-2">
                <Button type="submit" disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700">{saving ? "Saving..." : "Save kit"}</Button>
                <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            </div>
        </form>
    );
}