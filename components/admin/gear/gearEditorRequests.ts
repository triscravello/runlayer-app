import { isUsableVersion, parseGearItem, type GearEditorItem } from "./gearEditorModel";

// The editor's request boundary. Every function here NEVER THROWS: a rejected fetch, an unreadable body or an unexpected status becomes a
// classified outcome, so the editor can not be left waiting forever. Outcomes are decided by status AND by the server's `code`, because
// two different conflicts share HTTP 409 (STALE_VERSION: the item changed; CONFLICT: a name/brand uniqueness clash).

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function readJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false };
  }
}

async function errorCode(response: Response): Promise<string | null> {
  const body = await readJson(response);
  return body.ok && isRecord(body.value) && typeof body.value.code === "string" ? body.value.code : null;
}

/** A PATCH success body that has been checked: it is for the item that was saved and carries a usable new version. */
export type SavedItem = Record<string, unknown> & { id: string; version: number };

export type SaveOutcome =
  | { kind: "saved"; item: SavedItem }
  | { kind: "stale" }                                           // 409 STALE_VERSION: the item changed since it was loaded; nothing was written
  | { kind: "conflict" }                                        // 409 CONFLICT: another item already uses this name and brand
  | { kind: "notFound" }                                        // 404
  | { kind: "invalid" }                                         // 400
  | { kind: "rejected"; status: number }                       // any other 4xx (the status only selects a message; the body is never read for display)
  | { kind: "unauthorized"; status: 401 | 403 }
  | { kind: "unknown"; reason: "network" | "malformed" | "server" }   // the request may or may not have been applied
  | { kind: "badVersion" };                                     // no request was made: the token is not a usable version

/**
 * PATCH one gear item, always conditioned on `version`. A request is never sent without a usable token, and the token is never replaced
 * here: the caller decides which version to send, and a retry passes the same one.
 */
export async function patchGear(fetchImpl: FetchLike, itemId: string, version: unknown, payload: object): Promise<SaveOutcome> {
  if (!isUsableVersion(version) || typeof itemId !== "string" || itemId === "") return { kind: "badVersion" };

  let response: Response;
  try {
    response = await fetchImpl(`/api/admin/gear/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, expectedVersion: version }),
    });
  } catch {
    return { kind: "unknown", reason: "network" };
  }

  if (response.ok) {
    const body = await readJson(response);
    // A 2xx means the write happened. If the body can not be trusted we do NOT adopt anything from it: the outcome is "unknown".
    if (body.ok && isRecord(body.value) && body.value.id === itemId && isUsableVersion(body.value.version)) {
      return { kind: "saved", item: { ...body.value, id: itemId, version: body.value.version } };
    }
    return { kind: "unknown", reason: "malformed" };
  }

  if (response.status === 409) {
    const code = await errorCode(response);
    if (code === "STALE_VERSION") return { kind: "stale" };
    if (code === "CONFLICT") return { kind: "conflict" };
    return { kind: "rejected", status: 409 };
  }
  if (response.status === 404) return { kind: "notFound" };
  if (response.status === 400) return { kind: "invalid" };
  if (response.status === 401 || response.status === 403) return { kind: "unauthorized", status: response.status };
  if (response.status >= 500) return { kind: "unknown", reason: "server" };
  return { kind: "rejected", status: response.status };
}

export type CreateOutcome =
  | { kind: "created"; item: Record<string, unknown> & { id: string } }
  | { kind: "unauthorized"; status: 401 | 403 }
  | { kind: "unknown" }          // the item may or may not have been created
  | { kind: "failed" };

/** POST a new gear item: the existing contract, with no expectedVersion. */
export async function createGear(fetchImpl: FetchLike, payload: object): Promise<CreateOutcome> {
  let response: Response;
  try {
    response = await fetchImpl("/api/admin/gear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    return { kind: "unknown" };
  }
  if (response.ok) {
    const body = await readJson(response);
    return body.ok && isRecord(body.value) && typeof body.value.id === "string" ? { kind: "created", item: { ...body.value, id: body.value.id } } : { kind: "unknown" };
  }
  if (response.status === 401 || response.status === 403) return { kind: "unauthorized", status: response.status };
  return response.status >= 500 ? { kind: "unknown" } : { kind: "failed" };
}

export type LoadOutcome =
  | { kind: "loaded"; item: GearEditorItem }
  | { kind: "notFound" }                      // the list was read, and the requested id is not in it
  | { kind: "malformed" }                     // the response, or the requested item in it, is not usable
  | { kind: "unauthorized"; status: 401 | 403 }
  | { kind: "failed" };

/**
 * Reads the latest copy of ONE item from the existing authenticated list endpoint, uncached. The item is located by its exact id: if it
 * is missing the outcome is "notFound", never another item. The result is validated (id, fields, usable version) before it is returned.
 */
export async function loadLatestGear(fetchImpl: FetchLike, itemId: string): Promise<LoadOutcome> {
  let response: Response;
  try {
    response = await fetchImpl("/api/admin/gear", { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
  } catch {
    return { kind: "failed" };
  }
  if (response.status === 401 || response.status === 403) return { kind: "unauthorized", status: response.status };
  if (!response.ok) return { kind: "failed" };
  const body = await readJson(response);
  if (!body.ok || !Array.isArray(body.value)) return { kind: "malformed" };
  const match = body.value.find((entry: unknown) => isRecord(entry) && entry.id === itemId);
  if (match === undefined) return { kind: "notFound" };
  const item = parseGearItem(match);
  return item && item.id === itemId ? { kind: "loaded", item } : { kind: "malformed" };
}
