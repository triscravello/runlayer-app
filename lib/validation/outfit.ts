import { z } from "zod";
import {
    OUTFIT_DESCRIPTION_MAX_LENGTH,
    OUTFIT_ID_MAX_LENGTH,
    OUTFIT_MAX_GEAR_ITEMS,
    OUTFIT_NAME_MAX_LENGTH,
    normalizeKitType,
    type KitType,
} from "./outfitLimits";

// Request schemas for creating and updating a saved outfit ("kit"). Every message is fixed text: none of them
// includes the value the client sent, so a rejected request never echoes arbitrary input back.
//
// Unknown keys are stripped (not rejected) because the existing client also sends `recommendationId` on update,
// which the server has always ignored.

const BODY_MESSAGE = "Request body must be a JSON object.";
const GEAR_ID_MESSAGE = "Invalid gear item id.";
const AT_LEAST_ONE_MESSAGE = "Select at least one gear item.";
const GEAR_LIST_MESSAGE = "Gear items must be a list of ids.";
const KIT_TYPE_MESSAGE = "Unsupported kit type.";

const gearItemIdSchema = z
    .string({ error: GEAR_ID_MESSAGE })
    .trim()
    .min(1, GEAR_ID_MESSAGE)
    .max(OUTFIT_ID_MAX_LENGTH, GEAR_ID_MESSAGE);

const gearItemIdsList = z
    .array(gearItemIdSchema, { error: (issue) => (issue.input === undefined ? AT_LEAST_ONE_MESSAGE : GEAR_LIST_MESSAGE) })
    .min(1, AT_LEAST_ONE_MESSAGE)
    .max(OUTFIT_MAX_GEAR_ITEMS, `A kit can contain at most ${OUTFIT_MAX_GEAR_ITEMS} gear items.`);

const kitTypeSchema = z
    .string({ error: KIT_TYPE_MESSAGE })
    .refine((value) => normalizeKitType(value) !== null, KIT_TYPE_MESSAGE)
    .transform((value) => normalizeKitType(value) as KitType);

const nameSchema = z.string({ error: "Name must be text." }).trim().max(OUTFIT_NAME_MAX_LENGTH, `Name must be at most ${OUTFIT_NAME_MAX_LENGTH} characters.`).nullable().optional();
const descriptionSchema = z.string({ error: "Description must be text." }).trim().max(OUTFIT_DESCRIPTION_MAX_LENGTH, `Description must be at most ${OUTFIT_DESCRIPTION_MAX_LENGTH} characters.`).nullable().optional();
const isFavoriteSchema = z.boolean({ error: "isFavorite must be true or false." }).nullable().optional();
const kitTypeFieldSchema = kitTypeSchema.nullable().optional();
const recommendationIdSchema = z.string({ error: "Invalid recommendation id." }).trim().max(OUTFIT_ID_MAX_LENGTH, "Invalid recommendation id.").nullable().optional();

// `category` has always taken precedence over `type` (the client sends the same value in both).
const resolveKitType = (category: KitType | null | undefined, type: KitType | null | undefined): KitType | undefined => category ?? type ?? undefined;

export const createOutfitRequestSchema = z
    .object(
        {
            recommendationId: recommendationIdSchema,
            name: nameSchema,
            description: descriptionSchema,
            category: kitTypeFieldSchema,
            type: kitTypeFieldSchema,
            isFavorite: isFavoriteSchema,
            // Required on create: a kit with no gear is rejected.
            gearItemIds: gearItemIdsList,
        },
        { error: BODY_MESSAGE },
    )
    .transform(({ category, type, ...rest }) => ({ ...rest, kitType: resolveKitType(category, type) }));

export const updateOutfitRequestSchema = z
    .object(
        {
            name: nameSchema,
            description: descriptionSchema,
            category: kitTypeFieldSchema,
            type: kitTypeFieldSchema,
            isFavorite: isFavoriteSchema,
            // Optional on update (absent or null = leave the items alone), but never an empty list.
            gearItemIds: gearItemIdsList.nullable().optional(),
        },
        { error: BODY_MESSAGE },
    )
    .transform(({ category, type, ...rest }) => ({ ...rest, kitType: resolveKitType(category, type) }));

export type CreateOutfitRequest = z.output<typeof createOutfitRequestSchema>;
export type UpdateOutfitRequest = z.output<typeof updateOutfitRequestSchema>;

export type ParseResult<T> = { success: true; data: T } | { success: false; error: string };

function parseWith<T>(schema: z.ZodType<T>, json: unknown, fallback: string): ParseResult<T> {
    const result = schema.safeParse(json);
    if (result.success) return { success: true, data: result.data };
    return { success: false, error: result.error.issues[0]?.message ?? fallback };
}

export function parseCreateOutfitRequest(json: unknown): ParseResult<CreateOutfitRequest> {
    return parseWith(createOutfitRequestSchema, json, "Invalid save outfit payload.");
}

export function parseUpdateOutfitRequest(json: unknown): ParseResult<UpdateOutfitRequest> {
    return parseWith(updateOutfitRequestSchema, json, "Invalid update outfit payload.");
}

/** A usable outfit/recommendation id from a path or query parameter: a non-empty string of bounded length. */
export function parseOutfitId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= OUTFIT_ID_MAX_LENGTH ? trimmed : null;
}
