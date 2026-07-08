export type SerializableDate = Date | string | null | undefined;

export function toDate(value: SerializableDate): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function toTimestamp(value: SerializableDate): number {
    return toDate(value)?.getTime() ?? 0;
}