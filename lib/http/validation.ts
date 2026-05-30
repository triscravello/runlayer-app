import type { ZodType } from "zod";
import { BadRequestError } from "./apiErrors";

export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
    let json: unknown;

    try {
        json = await request.json();
    } catch {
        throw new BadRequestError("Request body must be a valid JSON");
    }

    return schema.parse(json);
}