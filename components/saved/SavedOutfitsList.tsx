"use client";

import { BookmarkCheck, CalendarDays } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import {
    OutfitCard,
    type OutfitCardPayload,
    type OutfitTag,
} from "@/components/recommendation/OutfitCard";
import { Card, CardContent } from "@/components/ui/Card";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export type SavedOutfitListItem = OutfitCardPayload & {
    id: string;
    savedAt: Date | string;
    weatherTags?: Array<string | OutfitTag>;
    workoutTags?: Array<string | OutfitTag>;
    quickReason?: string;
};

export type SavedOutfitsListProps = {
    outfits?: SavedOutfitListItem[];
    title?: string;
    subtitle?: string;
    emptyMessage?: string;
    onRevisit?: (outfit: SavedOutfitListItem) => void;
    className?: string;
};

const EMPTY_MESSAGE = "No saved outfits yet. Save recommendations to quickly revisit gear setups for future runs.";

function formatSavedDate(savedAt: Date | string) {
    const date = savedAt instanceof Date ? savedAt : new Date(savedAt);

    if (Number.isNaN(date.getTime())) {
        return "Saved data unavailable";
    }

    return `Saved ${new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric"
    }).format(date)}`;
}

function getContextTags(outfit: SavedOutfitListItem) {
    return [
        ...(outfit.weatherTags ?? []),
        ...(outfit.workoutTags ?? []),
        ...outfit.tags    
    ];
}

function getReasonSnippet(outfit: SavedOutfitListItem) {
    if (outfit.quickReason) {
        return [outfit.quickReason];
    }

    return undefined;
}

export function SavedOutfitsList({
    outfits = [],
    title = "Saved outfits",
    subtitle = "Reusable gear setups for conditions and workouts you run again",
    emptyMessage = EMPTY_MESSAGE,
    onRevisit,
    className,
}: SavedOutfitsListProps) {
    return (
        <section className={cn("space-y-5", className)} aria-labelledby="saved-outfits-heading">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                    <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
                        Gear library
                    </p>
                    <h2 id="saved-outfits-heading" className="text-2xl font-semibold text-emerald-950">
                        {title}
                    </h2>
                    <p className="max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
                </div>
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
                    <BookmarkCheck className="size-4" aria-hidden="true" />
                    {outfits.length} saved
                </div>
            </div>

            {outfits.length ? (
                <div className="grid gap-4" aria-label="Saved outfits">
                    {outfits.map((outfit) => (
                        <OutfitCard
                            key={outfit.id}
                            title={outfit.title}
                            tags={getContextTags(outfit)}
                            items={outfit.items}
                            attributes={outfit.attributes}
                            why={getReasonSnippet(outfit)}
                            saved
                            eyebrow={
                                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                                    <CalendarDays className="size-4" aria-hidden="true" />
                                    {formatSavedDate(outfit.savedAt)}
                                </span>
                            }
                            maxReasons={1}
                            showActions={Boolean(onRevisit)}
                            showSaveAction={false}
                            viewDetailsLabel="Reuse setup"
                            onViewDetails={() => onRevisit?.(outfit)}
                            className="border-slate-200 shadow-xs transition-shadow hover:shadow-md"
                        />
                    ))}
                </div>
            ) : (
                <Card className="border-dashed border-emerald-200 bg-emerald-50/50 shadow-none">
                    <CardContent className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                        <div className="flex size-12 items-center justify-center rounded-full bg-white text-emerald-700 shadow-xs">
                            <BookmarkCheck className="size-6" aria-hidden="true" />
                        </div>
                        <p className="max-w-md text-sm text-muted-foreground">{emptyMessage}</p>
                    </CardContent>
                </Card>
            )}
        </section>
    );
}