import { Lightbulb } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export type WhyReasonInput =
  | string
  | {
      reason?: string;
      reasons?: string[];
      tags?: string[];
      category?: string | null;
      item?: {
        tags?: string[];
        category?: string | null;
      };
      score?: number;
    };

export type WhyThisExplanationProps = {
  reasons?: WhyReasonInput | WhyReasonInput[];
  maxReasons?: 1 | 2 | 3 | 4;
  className?: string;
};

const DEFAULT_MAX_REASONS = 4;

const tagReasonMap: Array<[string, string]> = [
    ["ultralight", "Lightweight fabric to manage heat"],
    ["lightweight", "Lightweight fabric to manage heat"],
    ["breathable", "Breathable fabric dumps heat quickly"],
    ["moisture-wicking", "Fast-drying fabric handles sweat"],
    ["quick dry", "Fast-drying fabric handles sweat"],
    ["quick-dry", "Fast-drying fabric handles sweat"],
    ["anti-chafe", "Relaxed fit reduces chafing risk"],
    ["no chafe", "Relaxed fit reduces chafing risk"],
    ["performance-fit", "Matches your performance style preference"],
    ["race-day", "Race-ready build suits hard efforts"],
    ["race", "Race-ready build suits hard efforts"],
    ["tempo", "Matches your performance style preference"],
    ["training", "Durable enough for regular training miles"],
    ["layering", "Layerable coverage for cooler starts"],
    ["compression", "Secure fit limits excess movement"],
    ["built-in-liner", "Built-in liner reduces chafing risk"],
    ["packable", "Packable coverage adapts mid-run"],
    ["sweat-wicking", "Sweat-wicking details keep moisture moving"],
];

function normalizeText(value: string) {
    return value.toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

function titleCase(value: string) {
    return value
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
        .join(" ");
}

function translateScoringReason(reason: string) {
    const normalizedReason = normalizeText(reason);

    const weatherMatch = normalizedReason.match(/^fits (.+) conditions$/);
    if (weatherMatch?.[1]) {
        const condition = weatherMatch[1];

        if (["hot", "warm", "humid", "sunny"].includes(condition)) {
            return "Lightweight fabric to manage heat";
        }

        if (["cold", "cool"].includes(condition)) {
            return "Added coverage protects against cold";
        }

        if (["rain", "wet"].includes(condition)) {
            return "Weather-ready fabric handles rain";
        }

        if (condition === "wind") {
            return "Wind coverage without bulky layering";
        }

        return `Built for ${condition} conditions`;
    }

    const workoutMatch = normalizedReason.match(/^designed for (.+) runs$/);
    if (workoutMatch?.[1]) {
        return `Matches your ${workoutMatch[1]} run preference`;
    }

    if (
        normalizedReason.includes("high intensity") ||
        normalizedReason.includes("race efforts")
    ) {
        return "Race-ready build suits hard efforts";
    }

    if (normalizedReason.includes("fit preference")) {
        return "Matches your fit preference";
    }

    if (normalizedReason.includes("unisex fit")) {
        return "Flexible fit matches your preference";
    }

    return reason.trim();
}

function getTagReasons(tags: string[] = []) {
    return tags.flatMap((tag) => {
        const normalizedTag = normalizeText(tag);
        const match = tagReasonMap.find(
            ([tagKey]) => normalizedTag === normalizeText(tagKey),
        );

        return match ? [match[1]] : [];
    });
}

function flattenReasonInput(input?: WhyReasonInput | WhyReasonInput[]): string[] {
  if (!input) {
    return [];
  }

  const entries = Array.isArray(input) ? input : [input];

  return entries.flatMap((entry) => {
    if (typeof entry === "string") {
      return [translateScoringReason(entry)];
    }

    return [
      ...(entry.reason ? [translateScoringReason(entry.reason)] : []),
      ...(entry.reasons ?? []).map(translateScoringReason),
      ...getTagReasons(entry.tags),
      ...getTagReasons(entry.item?.tags),
      ...(entry.category ? [`Covers your ${titleCase(entry.category)} need`] : []),
      ...(entry.item?.category
        ? [`Covers your ${titleCase(entry.item.category)} need`]
        : []),
    ];
  });
}

function getUniqueReasons(reasons: string[]) {
    const seen = new Set<string>();

    return reasons.filter((reason) => {
        const cleanedReason = reason.trim().replace(/[.!?]+$/, "");
        const key = normalizeText(cleanedReason);

        if (!cleanedReason || seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

export function WhyThisExplanation({
    reasons,
    maxReasons = DEFAULT_MAX_REASONS,
    className,
} : WhyThisExplanationProps) {
    const displayReasons = getUniqueReasons(flattenReasonInput(reasons)).slice(
        0,
        maxReasons,
    );

    if (!displayReasons.length) return null;

    return (
        <section
            aria-label="Why this recommendation"
            className={cn(
                "rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-950",
                className,
            )}
        >
            <div className="mb-1.5 flex items-cener gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                <Lightbulb className="size-3.5" aria-hidden="true" />
                <span>Why this</span>
            </div>
            <ul className="space-y-1" aria-label="Recommendation reasoning">
                {displayReasons.map((reason) => (
                    <li key={reason} className="flex gap-2 leading-snug">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                        <span>{reason}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}