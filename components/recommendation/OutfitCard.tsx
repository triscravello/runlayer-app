"use client";

import * as React from "react";
import { Bookmark, Check, ChevronRight } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { Badge } from "@/components/ui/Badge";
import { 
  WhyThisExplanation,
  type WhyReasonInput,
} from "@/components/recommendation/WhyThisExplanation";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type OutfitTagTone = "default" | "weather" | "workout" | "attribute";

export type OutfitTag = {
  label: string;
  tone?: OutfitTagTone;
};

export type OutfitItem = {
  id: string;
  label: string;
  category: string;
  description?: string;
  attributes?: string[];
  group?: string;
  icon?: React.ReactNode;
};

export type OutfitAttribute = {
  label: string;
  value?: string;
};

export type OutfitCardPayload = {
  title: string;
  tags: Array<string | OutfitTag>;
  items: OutfitItem[];
  attributes: Array<string | OutfitAttribute>;
  why?: WhyReasonInput | WhyReasonInput[];
};

export type OutfitCardProps = {
  title?: string;
  tags: Array<string | OutfitTag>;
  items: OutfitItem[];
  attributes?: Array<string | OutfitAttribute>;
  why?: WhyReasonInput | WhyReasonInput[];
  saveLabel?: string;
  viewDetailsLabel?: string;
  saved?: boolean;
  onSave?: (outfit: OutfitCardPayload) => void;
  onViewDetails?: (outfit: OutfitCardPayload) => void;
  className?: string;
};

const tagToneClasses: Record<OutfitTagTone, string> = {
  default: "border-transparent bg-slate-100 text-slate-700",
  weather: "border-orange-200 bg-orange-50 text-orange-700",
  workout: "border-emerald-200 bg-emerald-50 text-emerald-700",
  attribute: "border-sky-200 bg-sky-50 text-sky-700",
};

function normalizeTag(tag: string | OutfitTag): OutfitTag {
  return typeof tag === "string" ? { label: tag } : tag;
}

function normalizeAttribute(attribute: string | OutfitAttribute): OutfitAttribute {
  return typeof attribute === "string" ? { label: attribute } : attribute;
}

function getGroupedItems(items: OutfitItem[]) {
  return items.reduce<Record<string, OutfitItem[]>>((groups, item) => {
    const groupName = item.group ?? item.category;
    groups[groupName] = [...(groups[groupName] ?? []), item];
    return groups;
  }, {});
}

export function OutfitCard({
  title = "Recommended Outfit",
  tags,
  items,
  attributes = [],
  why,
  saveLabel = "Save",
  viewDetailsLabel = "View Details",
  saved = false,
  onSave,
  onViewDetails,
  className,
}: OutfitCardProps) {
  const groupedItems = getGroupedItems(items);
  const outfitPayload: OutfitCardPayload = { title, tags, items, attributes, why };

  return (
    <Card
      className={cn(
        "overflow-hidden border-2 border-emerald-100 shadow-sm",
        className,
      )}
    >
      <CardHeader className="space-y-4 border-b bg-gradient-to-br from-white to-emerald-50/50 pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-xl font-semibold text-slate-950">
              {title}
            </CardTitle>
            <div className="flex flex-wrap gap-2" aria-label="Outfit context tags">
              {tags.map((tag) => {
                const normalizedTag = normalizeTag(tag);

                return (
                  <Badge
                    key={normalizedTag.label}
                    variant="outline"
                    className={cn(
                      "rounded-full px-3 py-1",
                      tagToneClasses[normalizedTag.tone ?? "default"],
                    )}
                  >
                    {normalizedTag.label}
                  </Badge>
                );
              })}
            </div>
          </div>
          {saved ? (
            <Badge className="rounded-full bg-emerald-600 px-3 py-1 text-white">
              <Check className="size-3" /> Saved
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-6">
        <div
          className="grid gap-3 md:grid-cols-3"
          aria-label="Outfit breakdown"
        >
          {Object.entries(groupedItems).map(([group, groupItems]) => (
            <div
              key={group}
              className="rounded-2xl border bg-white p-4 shadow-xs"
            >
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </div>
              <div className="space-y-3">
                {groupItems.map((item) => (
                  <div key={item.id} className="flex gap-3">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-2xl">
                      {item.icon ?? "•"}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="font-medium text-slate-950">{item.label}</div>
                      {item.description ? (
                        <p className="text-sm text-muted-foreground">
                          {item.description}
                        </p>
                      ) : null}
                      {item.attributes?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {item.attributes.map((attribute) => (
                            <Badge
                              key={`${item.id}-${attribute}`}
                              variant="outline"
                              className="rounded-full border-slate-200 px-2 py-0 text-[11px] text-slate-600"
                            >
                              {attribute}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {attributes.length ? (
          <div
            className="grid gap-2 sm:grid-cols-3"
            aria-label="Key outfit attributes"
          >
            {attributes.map((attribute) => {
              const normalizedAttribute = normalizeAttribute(attribute);

              return (
                <div
                  key={normalizedAttribute.label}
                  className="rounded-xl bg-slate-50 px-3 py-2 text-sm"
                >
                  <div className="font-medium text-slate-900">
                    {normalizedAttribute.label}
                  </div>
                  {normalizedAttribute.value ? (
                    <div className="text-muted-foreground">
                      {normalizedAttribute.value}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        <WhyThisExplanation reasons={why} />
      </CardContent>

      <CardFooter className="flex flex-col gap-3 border-t bg-slate-50/60 pt-4 sm:flex-row">
        <Button
          type="button"
          className="w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-1"
          onClick={() => onSave?.(outfitPayload)}
          disabled={!onSave || saved}
        >
          {saved ? (
            <Check className="size-4" />
          ) : (
            <Bookmark className="size-4" />
          )}
          {saved ? "Saved" : saveLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:flex-1"
          onClick={() => onViewDetails?.(outfitPayload)}
          disabled={!onViewDetails}
        >
          {viewDetailsLabel}
          <ChevronRight className="size-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}