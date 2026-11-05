import { z } from "zod";
import { BRAND_MAX_LENGTH, toBrandIdentity } from "@/lib/ingestion/brandResolution";

const trimmedString = z.string().trim();

// Same rules as the catalog importer: 1 to BRAND_MAX_LENGTH characters, no control characters, and a storable normalized
// key. The message is fixed text and never echoes the submitted value.
const BRAND_NAME_MESSAGE = `Brand name must be 1-${BRAND_MAX_LENGTH} characters with no control characters.`;

export const createBrandSchema = z.object({
    name: trimmedString
        .min(1, BRAND_NAME_MESSAGE)
        .max(BRAND_MAX_LENGTH, BRAND_NAME_MESSAGE)
        .refine((value) => toBrandIdentity(value) !== null, BRAND_NAME_MESSAGE),
    tier: trimmedString.optional().nullable(),
    style: trimmedString.optional().nullable(),
});

export type CreateBrandPayload = z.infer<typeof createBrandSchema>;
