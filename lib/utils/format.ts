import {
    DATE_TIME_FORMAT_OPTIONS,
    DEFAULT_LOCALE,
    FILE_SIZE_UNITS,
} from "./constants";

export function formatNumber(value: number, locale = DEFAULT_LOCALE): string {
    return new Intl.NumberFormat(locale).format(value);
}

export function formatCurrency(
    value: number,
    currency = "USD",
    locale = DEFAULT_LOCALE,
): string {
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
    }).format(value);
}

export function formatDateTime(
    value: Date | string | number,
    locale = DEFAULT_LOCALE,
): string {
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(locale, DATE_TIME_FORMAT_OPTIONS).format(date);
}

export function formatFileSize(bytes: number, precision = 2): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return "0 B";
    }

    if (bytes === 0) {
        return "0 B";
    }

    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), FILE_SIZE_UNITS.length - 1, );

    const value = bytes / 1024 ** exponent;

    return `${value.toFixed(precision)} ${FILE_SIZE_UNITS[exponent]}`;
}