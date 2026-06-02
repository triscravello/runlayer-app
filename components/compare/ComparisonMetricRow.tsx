import { Badge } from "../ui/Badge";

export type ComparisonMetricRowProps = {
    label: string;
    values: Array<{
        itemId: string;
        value: number | string | string[] | null | undefined;
        isBest?: boolean;
    }>;
}

function formatValue(value: ComparisonMetricRowProps["values"][number]["value"]) {
    if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
    if (typeof value === "number") return `${value > 0 ? "+" : ""}${value}`;
    return value || "—";
}

export function ComparisonMetricRow({ label, values }: ComparisonMetricRowProps) {
    return (
        <tr className="border-b border-slate-100 last:border-0">
            <th className="sticky left-0 z-10 min-w-36 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700">
                {label}
            </th>
            {values.map((entry) => (
                <td key={entry.itemId} className="min-w-56 px-4 py-3 text-sm text-slate-700">
                    <span className={entry.isBest ? "font-semibold text-emerald-700": undefined}>{formatValue(entry.value)}</span>
                    {entry.isBest ? <Badge className="ml-2 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Best</Badge> : null}
                </td>
            ))}
        </tr>
    );
}