export type ServiceRequestOptions = {
    signal?: AbortSignal;
};

export async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
    const data = (await response.json()) as T | { error?: string };

    if (!response.ok) {
        const message = typeof data === "object" && data !== null && "error" in data && data.error ? data.error : fallbackMessage;
        throw new Error(message);
    }

    return data as T;
}