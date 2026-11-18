import { buildGearPayload, parseGearItem, validateFields, type GearEditorItem } from "./gearEditorModel";
import { createGear, loadLatestGear, patchGear, type FetchLike, type SavedItem } from "./gearEditorRequests";
import { canSave, isDirty, type EditorAction, type EditorState } from "./gearEditorState";

// The editor's operations (save, retry, load latest), kept apart from React so their ordering rules can be tested deterministically.
// What it guarantees:
//   * ONE operation at a time, enforced by a synchronous flag (not by React state, which updates asynchronously): a second save, retry or
//     reload while one is running is ignored, so a double click can never send two requests with the same token.
//   * Every request captures the item id, the token and the draft snapshot BEFORE anything is dispatched; later state can not change them.
//   * Discarding a draft ("load latest") requires an explicit confirmation; declining leaves every piece of state untouched.
//   * A retry re-sends the exact stored snapshot with the exact stored token. Nothing here ever substitutes a newer token.
//   * Parent callbacks receive the id of the item the request was about, so a late response updates THAT item and no other.

export const DISCARD_MESSAGE = "Discard your unsaved edits and load the latest version from the server? This can't be undone.";

export type ControllerCallbacks = {
  brands: ReadonlyArray<{ id: string; name: string }>;
  /** A save of `itemId` succeeded: `saved` is the validated PATCH response (scalar columns only). */
  onSaved?: (itemId: string, saved: SavedItem) => void;
  /** The latest server copy of `itemId` was read (after "load latest" or "check latest"). */
  onReloaded?: (itemId: string, item: GearEditorItem) => void;
  /** A new item was created. */
  onCreated?: (item: GearEditorItem) => void;
};

export type ControllerDeps = {
  getState: () => EditorState;
  dispatch: (action: EditorAction) => void;
  fetchImpl: FetchLike;
  confirm: (message: string) => boolean;
  callbacks: () => ControllerCallbacks;
};

export type EditorController = {
  /** Save the current draft (edit: conditioned on the baseline version; create: POST). */
  save: () => Promise<void>;
  /** After an unconfirmed save: re-send the identical request with the identical token. */
  retrySame: () => Promise<void>;
  /** "reload": replace the draft with the latest server copy (after confirmation). "check": learn what happened to an unconfirmed save. */
  loadLatest: (intent: "reload" | "check") => Promise<void>;
};

/** Parent callbacks are notifications: whatever they do, they can not break the editor, so a throwing one is reported and ignored. */
function notify(callback: () => void) {
  try {
    callback();
  } catch (error) {
    console.error("Gear editor callback failed", error);
  }
}

export function createEditorController(deps: ControllerDeps): EditorController {
  let busy = false;
  let generation = 0;

  async function runSave(retry: boolean): Promise<void> {
    if (busy) return;
    const state = deps.getState();

    let snapshot = { ...state.draft };
    let version = state.version;
    if (retry) {
      if (state.status !== "unknown" || !state.unknown) return;
      snapshot = state.unknown.snapshot;
      version = state.unknown.version;
    } else {
      if (!canSave(state)) return;
      const invalid = validateFields(state.draft);
      if (invalid) {
        deps.dispatch({ type: "localInvalid", message: invalid });
        return;
      }
    }

    busy = true;
    const mine = ++generation;
    const itemId = state.itemId;
    try {
      deps.dispatch(retry ? { type: "retryStarted", generation: mine } : { type: "saveStarted", generation: mine, snapshot });
      try {
        const payload = buildGearPayload(snapshot);

        if (state.mode === "create") {
          const outcome = await createGear(deps.fetchImpl, payload);
          if (outcome.kind !== "created") {
            deps.dispatch({ type: "saveFinished", generation: mine, outcome });
            return;
          }
          // The created item must be usable by the catalog. A fresh row's version is 0 by default; an unreadable body is an unconfirmed create.
          const parsed = parseGearItem(outcome.item.version === undefined ? { ...outcome.item, version: 0 } : outcome.item);
          if (!parsed) {
            deps.dispatch({ type: "saveFinished", generation: mine, outcome: { kind: "unknown" } });
            return;
          }
          deps.dispatch({ type: "saveFinished", generation: mine, outcome });
          const brand = deps.callbacks().brands.find((candidate) => candidate.id === parsed.brandId);
          notify(() => deps.callbacks().onCreated?.(brand ? { ...parsed, brand: { name: brand.name } } : parsed));
          return;
        }

        if (itemId === null) {
          deps.dispatch({ type: "saveFinished", generation: mine, outcome: { kind: "badVersion" } });
          return;
        }
        const outcome = await patchGear(deps.fetchImpl, itemId, version, payload);
        deps.dispatch({ type: "saveFinished", generation: mine, outcome });
        if (outcome.kind === "saved") notify(() => deps.callbacks().onSaved?.(itemId, outcome.item));
      } catch {
        // Nothing here is expected to throw, but if anything does, the editor must settle instead of staying "saving" forever. The save may or
        // may not have been sent, so it is an unconfirmed outcome. (A no-op if the outcome was already recorded.)
        deps.dispatch({ type: "saveFinished", generation: mine, outcome: state.mode === "create" ? { kind: "unknown" } : { kind: "unknown", reason: "network" } });
      }
    } finally {
      busy = false;
    }
  }

  async function loadLatest(intent: "reload" | "check"): Promise<void> {
    if (busy) return;
    const state = deps.getState();
    const allowed = (intent === "reload" && state.status === "stale") || (intent === "check" && state.status === "unknown" && state.unknown !== null);
    if (!allowed || state.itemId === null) return;
    // Discarding edits needs an explicit yes. Declining changes nothing: no request, no state change.
    if (intent === "reload" && isDirty(state) && !deps.confirm(DISCARD_MESSAGE)) return;

    busy = true;
    const mine = ++generation;
    const itemId = state.itemId;
    try {
      deps.dispatch({ type: "reloadStarted", generation: mine, intent });
      try {
        const outcome = await loadLatestGear(deps.fetchImpl, itemId);
        deps.dispatch({ type: "reloadFinished", generation: mine, outcome });
        if (outcome.kind === "loaded") notify(() => deps.callbacks().onReloaded?.(itemId, outcome.item));
      } catch {
        deps.dispatch({ type: "reloadFinished", generation: mine, outcome: { kind: "failed" } });   // never stay "reloading"
      }
    } finally {
      busy = false;
    }
  }

  return { save: () => runSave(false), retrySame: () => runSave(true), loadLatest };
}
