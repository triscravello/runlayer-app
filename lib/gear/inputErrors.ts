// Controlled errors for malformed gear write input. Pure: no I/O and no framework imports, so scripts and the ingestion
// helpers can use it too.
//
// Messages are built only from fixed text, field names and array positions. They never include a submitted value, so an
// error can be logged or reported as is.

export class InvalidGearInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidGearInputError";
    }
}

/** True for object literals and null-prototype objects only (not arrays, class instances, Dates or null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
