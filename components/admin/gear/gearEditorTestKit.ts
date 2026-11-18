import { createEditorController } from "./gearEditorController";
import type { EditableFields, GearEditorItem } from "./gearEditorModel";
import type { FetchLike, SavedItem } from "./gearEditorRequests";
import { createEditorState, editorReducer, type EditorAction, type EditorMode, type EditorState } from "./gearEditorState";

// Shared test support for the admin editor suites: an item fixture, scripted HTTP responses, and a harness that drives the REAL reducer and
// controller against a scripted fetch, so races and ordering are deterministic. Not a test file; nothing here touches the network.

export const gearItem = (overrides: Partial<GearEditorItem> = {}): GearEditorItem => ({
  id: "g1", name: "Trail Tee", brandId: "b1", brand: { name: "Acme" }, category: "TOP", priceRange: "MID", genderTarget: "MEN", subcategory: "tee",
  tags: ["light"], bodyTypeFit: ["slim"], imageUrl: null, affiliateUrl: "https://shop.example.com/a", weatherHot: 0.4, weatherCold: 0.1, weatherRain: null, weatherWind: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", version: 3, ...overrides,
});

export const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export const textResponse = (text: string, status = 200) => new Response(text, { status });
export const errorBody = (code: string, error = "x") => ({ error, code });

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** What the server would answer to a successful PATCH: the updated scalar row with the next version. */
export const savedRow = (overrides: Record<string, unknown> = {}) => ({ id: "g1", name: "Trail Tee", brandId: "b1", category: "TOP", priceRange: "MID", version: 4, updatedAt: "2026-02-01T00:00:00.000Z", ...overrides });

export type Scripted = Response | Error | (() => Promise<Response>);
export type RecordedRequest = { url: string; method: string; body: Record<string, unknown> | undefined; cache: RequestCache | undefined };

/**
 * `lagged: true` models React: a dispatch updates the reducer's state immediately, but what the controller can SEE through getState() only
 * changes at flush(), like a re-render committing later. Rapid clicks before a flush therefore all see the old state, which is exactly the
 * window the controller's synchronous in-flight guard exists for.
 */
export function createHarness({ item = gearItem(), mode = "edit" as EditorMode, responses = [] as Scripted[], confirmAnswer = true, brands = [] as Array<{ id: string; name: string }>, lagged = false } = {}) {
  let state: EditorState = createEditorState(mode === "create" ? null : item, mode);
  let visible = state;
  const actions: EditorAction[] = [];
  const requests: RecordedRequest[] = [];
  const queue = [...responses];
  const events = { saved: [] as Array<{ id: string; saved: SavedItem }>, reloaded: [] as Array<{ id: string; item: GearEditorItem }>, created: [] as GearEditorItem[], confirms: [] as string[] };
  let answer = confirmAnswer;

  const dispatch = (action: EditorAction) => { actions.push(action); state = editorReducer(state, action); if (!lagged) visible = state; };
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined, cache: init?.cache });
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected request to ${url}`);
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  };
  const controller = createEditorController({
    getState: () => visible,
    dispatch,
    fetchImpl,
    confirm: (message) => { events.confirms.push(message); return answer; },
    callbacks: () => ({ brands, onSaved: (id, saved) => events.saved.push({ id, saved }), onReloaded: (id, loaded) => events.reloaded.push({ id, item: loaded }), onCreated: (created) => events.created.push(created) }),
  });
  return {
    get state() { return state; },
    /** Commit the reducer state so the controller can see it (only meaningful with lagged: true). */
    flush() { visible = state; },
    dispatch, controller, requests, actions, events, queue,
    setConfirm(value: boolean) { answer = value; },
    edit(key: keyof EditableFields, value: string) { dispatch({ type: "edit", key, value }); },
  };
}
