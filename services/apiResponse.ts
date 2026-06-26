export type ServiceRequestOptions = {
    signal?: AbortSignal;
};

export async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const data = isJson ? ((await response.json()) as T | { error?: string }) : null;

    if (!response.ok) {
        const message = data && typeof data === "object" && data !== null && "error" in data && data.error ? data.error : fallbackMessage;
        throw new Error(message);
    }

    if (!isJson) {
        throw new Error(fallbackMessage);
    }

    return data as T;
}