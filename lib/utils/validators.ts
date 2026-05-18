import { EMAIL_REGEX, SLUG_REGEX } from "./constants";

export function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

export function isEmail(value: string): boolean {
    return EMAIL_REGEX.test(value.trim());
}

export function isSlug(value: string): boolean {
    return SLUG_REGEX.test(value.trim());
}

export function isUrl(value: string): boolean {
    try {
        // eslint-disable-next-line no-new
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

export function isInRange(
    value: number,
    min: number,
    max: number,
    options: { inclusive?: boolean } = {},
): boolean {
    if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
        return false;
    }

    if (options.inclusive ?? true) {
        return value >= min && value <= max;
    }

    return value > min && value < max;
}