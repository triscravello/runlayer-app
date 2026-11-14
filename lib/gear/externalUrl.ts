// The one policy for a link that is shown to a user as a clickable shopping link. Pure: no I/O, no framework imports, so it
// is safe to use from server code, client components and tests alike.
//
// A value is a safe link only if ALL of these hold:
//  - it is a string of at most 2048 characters;
//  - it contains no whitespace or control characters (the URL parser silently strips tabs and newlines, so
//    `java\tscript:` would otherwise parse as `javascript:`);
//  - it starts with `http://` or `https://`, compared case-insensitively (schemes are case-insensitive, so `HTTPS://x` is a
//    valid link), which excludes every other scheme, relative paths and protocol-relative `//host`;
//  - it parses, and has a host;
//  - its authority carries no `@`, so no embedded credentials and no `https://trusted.example@evil.example` look-alikes.
//
// This is deliberately not an allowlist of hosts: affiliate partners vary. It decides what may be an <a href>, nothing more.

export const MAX_EXTERNAL_URL_LENGTH = 2048;

const HTTP_PREFIX = /^https?:\/\//i;
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f]/;

export function isSafeHttpUrl(value: unknown): value is string {
    if (typeof value !== "string" || value === "" || value.length > MAX_EXTERNAL_URL_LENGTH) return false;
    if (WHITESPACE_OR_CONTROL.test(value)) return false;

    const prefix = HTTP_PREFIX.exec(value);
    if (!prefix) return false;

    // The authority is read from the raw text, before any parser normalization can hide an '@'.
    const authority = value.slice(prefix[0].length).split(/[/?#]/, 1)[0];
    if (authority === "" || authority.includes("@")) return false;

    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "" && url.username === "" && url.password === "";
    } catch {
        return false;
    }
}

/** The value unchanged if it is a safe link, otherwise null. */
export function safeHttpUrl(value: unknown): string | null {
    return isSafeHttpUrl(value) ? value : null;
}
