export const APP_NAME = "RunLayer";

export const DEFAULT_LOCALE = "en-US";

export const DEFAULT_TIME_ZONE = "UTC";

export const DATE_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
};

export const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;