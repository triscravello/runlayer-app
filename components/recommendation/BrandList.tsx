import * as React from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { Badge } from "@/components/ui/Badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type BrandListLayout = "grid" | "horizontal";

export type BrandListItem = {
  id: string;
  name: string;
  summary?: string;
  tags?: string[];
  why?: string;
  rank?: number;
  score?: number;
  href?: string;
};

export type BrandListProps = {
  brands: BrandListItem[];
  title?: string;
  subtitle?: string;
  filterTags?: string[];
  maxItems?: number;
  layout?: BrandListLayout;
  showWhy?: boolean;
  emptyMessage?: string;
  className?: string;
};

function normalizeTag(tag: string) {
  return tag.trim().toLowerCase();
}

function hasMatchingTag(brand: BrandListItem, filterTags: string[]) {
  if (!filterTags.length) {
    return true;
  }

  const brandTags = new Set((brand.tags ?? []).map(normalizeTag));
  return filterTags.some((tag) => brandTags.has(normalizeTag(tag)));
}

function getRankedBrands(
  brands: BrandListItem[],
  filterTags: string[],
  maxItems: number,
) {
  return [...brands]
    .filter((brand) => hasMatchingTag(brand, filterTags))
    .sort((a, b) => {
      const rankA = a.rank ?? Number.POSITIVE_INFINITY;
      const rankB = b.rank ?? Number.POSITIVE_INFINITY;

      if (rankA !== rankB) {
        return rankA - rankB;
      }

      return (b.score ?? 0) - (a.score ?? 0);
    })
    .slice(0, maxItems);
}

export function BrandList({
  brands,
  title = "Relevant brands",
  subtitle = "Non-core enrichment based on the outfit context.",
  filterTags = [],
  maxItems = 6,
  layout = "grid",
  showWhy = false,
  emptyMessage = "No brand matches yet.",
  className,
}: BrandListProps) {
  const rankedBrands = getRankedBrands(brands, filterTags, maxItems);

  return (
    <Card className={cn("border-slate-200 shadow-sm", className)}>
      <CardHeader className="space-y-2 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-lg font-semibold text-slate-950">
              {title}
            </CardTitle>
            <CardDescription className="text-sm">{subtitle}</CardDescription>
          </div>
          <Badge
            variant="outline"
            className="rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700"
          >
            <Sparkles className="size-3" /> Enrichment
          </Badge>
        </div>

        {filterTags.length ? (
          <div className="flex flex-wrap gap-2" aria-label="Brand filters">
            {filterTags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="rounded-full border-slate-200 px-2 py-0 text-[11px] text-slate-600"
              >
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardHeader>

      <CardContent>
        {rankedBrands.length ? (
          <div
            className={cn(
              layout === "horizontal"
                ? "flex snap-x gap-3 overflow-x-auto pb-2"
                : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
            )}
            aria-label="Recommended brands"
          >
            {rankedBrands.map((brand, index) => {
              const rankLabel = brand.rank ?? index + 1;
              const content = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge className="rounded-full bg-slate-950 px-2 py-0.5 text-white">
                          #{rankLabel}
                        </Badge>
                        <h3 className="truncate font-semibold text-slate-950">
                          {brand.name}
                        </h3>
                      </div>
                      {brand.summary ? (
                        <p className="mt-2 text-sm leading-5 text-muted-foreground">
                          {brand.summary}
                        </p>
                      ) : null}
                    </div>
                    {brand.href ? <ExternalLink className="size-4 shrink-0" /> : null}
                  </div>

                  {brand.tags?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {brand.tags.slice(0, 4).map((tag) => (
                        <Badge
                          key={`${brand.id}-${tag}`}
                          variant="outline"
                          className="rounded-full border-slate-200 px-2 py-0 text-[11px] text-slate-600"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  {showWhy && brand.why ? (
                    <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                      <span className="font-medium">Why this brand: </span>
                      {brand.why}
                    </div>
                  ) : null}
                </>
              );

              const cardClassName = cn(
                "flex flex-col gap-3 rounded-2xl border bg-white p-4 text-left shadow-xs transition-colors hover:border-emerald-200 hover:bg-emerald-50/40",
                layout === "horizontal" && "min-w-[240px] snap-start sm:min-w-[280px]",
              );

              return brand.href ? (
                <a
                  key={brand.id}
                  href={brand.href}
                  target="_blank"
                  rel="noreferrer"
                  className={cardClassName}
                >
                  {content}
                </a>
              ) : (
                <div key={brand.id} className={cardClassName}>
                  {content}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed bg-slate-50 px-4 py-6 text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        )}
      </CardContent>
    </Card>
  );
}