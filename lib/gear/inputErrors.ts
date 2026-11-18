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

/** Raised when a gear item targeted by an update does not exist. Carries no id, so it can be reported as is. */
export class GearItemNotFoundError extends Error {
    constructor() {
        super("Gear item not found");
        this.name = "GearItemNotFoundError";
    }
}

/**
 * Raised when an update carried an expected version and the stored item no longer has it: someone else changed the item since the
 * caller read it. Carries no version, id or value. Never raised for an unconditional update, and never for a transaction timeout.
 */
export class GearItemStaleVersionError extends Error {
    constructor() {
        super("Gear item was changed by someone else");
        this.name = "GearItemStaleVersionError";
    }
}

/** `gear_items.version` is a 32-bit signed INTEGER; a token outside it can never match a stored value. */
const MAX_VERSION = 2_147_483_647;

/**
 * Validates an optional concurrency token before any database access. `undefined` means "unconditional"; anything else must be
 * a non-negative safe integer that fits the column. `null`, strings, floats, NaN and negative numbers are refused, never coerced.
 */
export function assertExpectedVersion(value: unknown): asserts value is number | undefined {
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_VERSION) {
        throw new InvalidGearInputError("Invalid gear update: expectedVersion must be a non-negative integer");
    }
}
