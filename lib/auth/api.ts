import type { NextRequest } from "next/server";
import { requireAuth, type SessionUser } from "@/lib/auth";
import { errorResponse } from "../http/apiErrors";

type AdminRouteContext = Record<string, unknown>;
type AdminRouteHandler<TContext extends AdminRouteContext = AdminRouteContext> = (
    request: NextRequest,
    context: TContext,
    admin: SessionUser,
) => Promise<Response> | Response;

export function withAdmin<TContext extends AdminRouteContext = AdminRouteContext>(handler: AdminRouteHandler<TContext>) {
    return async (request: NextRequest, context: TContext) => {
        try {
            const admin = await requireAuth();
            return await handler(request, context, admin);
        } catch (error) {
            return errorResponse(error, "Admin request failed");
        }
    }
}