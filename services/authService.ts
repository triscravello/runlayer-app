export interface AuthSuccessResponse {
    success: true;
    data: {
        token: string;
        user: {
            id: string;
            email: string;
            username: string;
        }
    }
}

export interface AuthErrorResponse {
    success: false;
    error: {
        code: string;
        message: string;
    }
}

export interface SignupPayload {
    email: string;
    password: string;
};

export interface LoginPayload {
    username: string;
    password: string;
}

async function parseAuthResponse(response: Response): Promise<AuthSuccessResponse> {
    const data = (await response.json()) as AuthSuccessResponse | AuthErrorResponse;

    if (!response.ok || !data.success) {
        const fallback = `Request failed with status ${response.status}`;
        const message = 'error' in data ? data.error.message: fallback;
        throw new Error(message || fallback);
    }

    return data;
}

export const authService = {
    async signup(payload: SignupPayload): Promise<AuthSuccessResponse> {
        const response = await fetch("/api/auth/signup", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify(payload),
        })

        return parseAuthResponse(response);
    },

    async login(payload: LoginPayload): Promise<AuthSuccessResponse> {
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify(payload),
        })

        return parseAuthResponse(response);
    }
}