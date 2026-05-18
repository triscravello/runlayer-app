export function normalizeText(value: string | null | undefined): string {
    return (value ?? "").trim().toLowerCase();
}

export function normalizeToken(value: string | null | undefined): string {
    return normalizeText(value).replace(/[-_\s]+/g, "");
}

export function titleCase(value: string): string {
    return value.split(/[\s_-]+/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`).join(" ");
}