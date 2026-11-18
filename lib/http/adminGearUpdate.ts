import { BadRequestError } from "./apiErrors";
import { parseJsonBody } from "./validation";
import { updateGearItemSchema, type UpdateGearItemPayload } from "@/lib/validation/adminGear";

/** Parses a PATCH /api/admin/gear/[id] body. A body `id` that disagrees with the URL is a 400, never silently ignored. */
export async function parseGearUpdateRequest(request: Request, urlId: string): Promise<UpdateGearItemPayload> {
    const body = await parseJsonBody(request, updateGearItemSchema);
    if (body.id !== undefined && body.id !== urlId) throw new BadRequestError("Body id does not match the URL id");
    return body;
}

/**
 * Separates the concurrency token from the gear fields of a validated PATCH body. The token travels as service OPTIONS, never as update
 * data, and the options argument exists only when a token was sent, so a request without one calls the service exactly as before
 * (unconditional, last write wins).
 */
export function splitGearUpdateBody(body: UpdateGearItemPayload): { data: Omit<UpdateGearItemPayload, "expectedVersion">; options?: { expectedVersion: number } } {
    const { expectedVersion, ...data } = body;
    return expectedVersion === undefined ? { data } : { data, options: { expectedVersion } };
}
