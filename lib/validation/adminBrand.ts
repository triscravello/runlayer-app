import { z } from "zod";

const trimmedString = z.string().trim();

export const createBrandSchema = z.object({
    name: trimmedString.min(1).max(120),
    tier: trimmedString.optional().nullable(),
    style: trimmedString.optional().nullable(),
});

export type CreateBrandPayload = z.infer<typeof createBrandSchema>;