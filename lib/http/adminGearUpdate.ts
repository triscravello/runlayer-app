import { BadRequestError } from "./apiErrors";
import { parseJsonBody } from "./validation";
import { updateGearItemSchema, type UpdateGearItemPayload } from "@/lib/validation/adminGear";

/** Parses a PATCH /api/admin/gear/[id] body. A body `id` that disagrees with the URL is a 400, never silently ignored. */
export async function parseGearUpdateRequest(request: Request, urlId: string): Promise<UpdateGearItemPayload> {
    const body = await parseJsonBody(request, updateGearItemSchema);
    if (body.id !== undefined && body.id !== urlId) throw new BadRequestError("Body id does not match the URL id");
    return body;
}
