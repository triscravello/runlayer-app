export function groupBy<T, K extends string | number | symbol>(
    items: readonly T[],
    getKey: (item: T) => K,
): Record<K, T[]> {
    return items.reduce<Record<K, T[]>>((groups, item) => {
        const key = getKey(item);
        groups[key] = [...(groups[key] ?? []), item];
        return groups;
    }, {} as Record<K, T[]>);
}

export function uniqueBy<T, K extends string | number>(
    items: readonly T[],
    getKey: (item: T) => K,
): T[] {
    const seen = new Set<K>();
    const uniqueItems: T[] = [];

    for (const item of items) {
        const key = getKey(item);
        if (!seen.has(key)) {
            seen.add(key);
            uniqueItems.push(item);
        }
    }

    return uniqueItems;
}