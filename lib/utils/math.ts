export function clamp(value: number, min = 0, max = 1): number {
    if (min > max) {
        return clamp(value, max, min);
    }

    return Math.min(Math.max(value, min), max);
}

export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
    return denominator === 0 ? fallback : numerator / denominator;
}

export function normalize(value: number, min: number, max: number): number {
    return clamp(safeDivide(value - min, max - min));
}

export function roundTo(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

export function weightedSum(values: Array<{ value: number; weight: number }>): number {
    const totalWeight = values.reduce((sum, entry) => sum + entry.weight, 0);

    if (totalWeight === 0) {
        return 0;
    }

    return values.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
}