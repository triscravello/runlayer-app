import type { NextRequest } from "next/server";
import { requireAdmin, requireAuth, type SessionUser } from "@/lib/auth";
import { errorResponse } from "../http/apiErrors";

type RouteContext = object;
type AuthRouteHandler<TContext extends RouteContext = RouteContext> = (
    request: NextRequest,
    contect: TContext,
    user: SessionUser,
) => Promise<Response> | Response;

export function withAuth<TContext extends RouteContext = RouteContext>(handler: AuthRouteHandler<TContext>) {
    return async (request: NextRequest, context: TContext) => {
        try {
            const user = await requireAuth();
            return await handler(request, context, user);
        } catch (error) {
            return errorResponse(error, "Authenticated request failed");
        }
    };
}

export function withAdmin<TContext extends RouteContext = RouteContext>(handler: AuthRouteHandler<TContext>) {
    return async (request: NextRequest, context: TContext) => {
        try {
            const admin = await requireAdmin();
            return await handler(request, context, admin);
        } catch (error) {
            return errorResponse(error, "Admin request failed");
        }
    };
}