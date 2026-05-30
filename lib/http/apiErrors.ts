import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
    constructor (
        public readonly status: number,
        message: string,
        public readonly code?: string,
    ) {
        super(message);
        this.name = "HttpError";
    }
}

export class UnauthorizedError extends HttpError {
    constructor(message = "Unauthorized") {
        super(401, message, "UNAUTHORIZED");
        this.name = "UnauthorizedError";
    }
}

export class ForbiddenError extends HttpError {
    constructor(message = "Forbidden") {
        super(403, message, "FORBIDDEN");
        this.name = "ForbiddenError";
    } 
}

export class BadRequestError extends HttpError {
    constructor(message = "Invalid request") {
        super(400, message, "BAD REQUEST");
        this.name = "BadRequestError";
    }
}

export function errorResponse(error: unknown, fallbackMessage = "Request failed") {
    if (error instanceof ZodError) {
        return NextResponse.json(
            {
                error: "Invalid request payload",
                issues: error.issues.map((issue) => ({
                    path: issue.path.join("."),
                    message: issue.message,
                })),
            },
            { status: 400 },
        );
    }

    if (error instanceof HttpError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    console.error(fallbackMessage, error);
    return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}