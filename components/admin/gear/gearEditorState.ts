import type { SerializableDate } from "@/lib/utils/date";
import { fieldsEqual, isUsableVersion, toFields, type EditableFields, type GearEditorItem } from "./gearEditorModel";
import type { CreateOutcome, LoadOutcome, SaveOutcome } from "./gearEditorRequests";

// The admin gear editor's state model: a plain reducer, no React, no network. It owns everything that must stay consistent across
// asynchronous steps: which item is being edited, the draft, the BASELINE (the version token and field values the draft started from), the
// status, and a request generation so a late response can never be applied to the wrong request.
//
// The rules that matter:
//   * The version token is read only from `version` here, never from props. It is replaced only by a successful save of THIS item
//     (adopting the server's returned version) or by an explicit, successful "load latest". Nothing else changes it.
//   * A conflict, an unconfirmed save, an authorization failure and every error keep the draft exactly as it was.
//   * While a request is in flight editing is locked, so the draft can not change under it. While a save's outcome is unknown, editing
//     stays possible: a retry re-sends the stored snapshot (not the draft), and a later success makes THAT snapshot the baseline, so edits
//     made in between correctly remain unsaved.
//   * A response is applied only if it carries the generation of the request that is pending. Anything else is ignored.

export type EditorMode = "edit" | "create";

export type EditorStatus =
  | "idle"          // nothing in flight; the draft may or may not differ from the baseline (see isDirty)
  | "saving"        // a save request is in flight
  | "saved"         // the last save succeeded
  | "error"         // a save failed in a way the user can fix and retry (validation, name conflict, generic failure)
  | "stale"         // the server item changed since the baseline: saving is blocked until the user loads the latest version
  | "unknown"       // a save was sent but its outcome is not known; it may have been applied
  | "reloading"     // a "load latest" / "check latest" request is in flight
  | "unauthorized"  // 401/403: the draft is kept; the user can sign in again and save manually
  | "missing";      // 404: the item no longer exists

export type PendingRequest = {
  generation: number;
  kind: "save" | "reload" | "check";
  /** The exact draft that was submitted (save) or that existed when the request began (reload/check). */
  snapshot: EditableFields;
  /** The version token that was sent (save) or that the baseline had (reload/check). */
  version: number | null;
  /** The status to return to if the request fails without a usable result. */
  returnTo: EditorStatus;
};

export type EditorState = {
  mode: EditorMode;
  /** The item being edited; null in create mode. */
  itemId: string | null;
  draft: EditableFields;
  /** The draft as of the baseline: what the server is believed to hold. The draft is "dirty" when it differs. */
  base: EditableFields;
  /** The baseline concurrency token; null when it is missing or malformed (then saving is impossible) or in create mode. */
  version: number | null;
  /** Edit mode, and the item that was loaded had no usable version. */
  versionProblem: boolean;
  /** The updatedAt the editor displays; follows the baseline. */
  updatedAt: SerializableDate;
  status: EditorStatus;
  /** A user-facing error (shown as an alert). Cleared by editing only when the status allows it. */
  message: string | null;
  /** A non-error notice (shown in a polite live region). */
  info: string | null;
  /**
   * A message from something UNRELATED to the save (a failed brand creation or delete). It is shown on its own and never changes `status`,
   * so a late failure can not clear or replace a stale conflict, an unconfirmed save or an in-flight request.
   */
  sideMessage: string | null;
  /** The user chose "Keep editing" on the stale-conflict notice. Saving stays blocked. */
  conflictAcknowledged: boolean;
  /** The generation of the most recently started request. */
  generation: number;
  pending: PendingRequest | null;
  /** A save that was sent but whose outcome is unknown: its exact snapshot and token, kept for an identical retry. */
  unknown: { snapshot: EditableFields; version: number } | null;
};

export const MESSAGES = {
  versionProblem: "This item's version is missing or invalid, so it can't be saved safely. Reload the page and try again.",
  editFailed: "Save failed. Check the item data and try again.",
  createFailed: "Create failed. Check the required fields and brand ID, then try again.",
  createUnknown: "We couldn't confirm that the item was created. Check the catalog before trying again.",
  nameConflict: "Another gear item already uses this name and brand. Change the name or brand, then save again.",
  notFound: "This gear item no longer exists, so the changes can't be saved. Your edits are still in the form.",
  unauthorized: "You are not signed in as an administrator (your session may have expired), so nothing was saved. Your edits are still in the form. Sign in again, then press Save.",
  reloadFailed: "Couldn't load the latest version. Your edits are kept.",
  reloadMalformed: "The latest version couldn't be read safely, so nothing was changed. Your edits are kept.",
  loaded: "Loaded the latest version from the server. Your earlier edits were discarded.",
  adopted: "Your save had been applied. The editor now has the latest version.",
  notApplied: "The server still has the version you started from, so your save was not applied. Your edits are kept; you can save again.",
} as const;

export type EditorAction =
  | { type: "edit"; key: keyof EditableFields; value: string }
  | { type: "localInvalid"; message: string }
  | { type: "saveStarted"; generation: number; snapshot: EditableFields }
  | { type: "saveFinished"; generation: number; outcome: SaveOutcome | CreateOutcome }
  | { type: "retryStarted"; generation: number }
  | { type: "keepEditing" }
  | { type: "reloadStarted"; generation: number; intent: "reload" | "check" }
  | { type: "reloadFinished"; generation: number; outcome: LoadOutcome };

export function createEditorState(item: GearEditorItem | null | undefined, mode: EditorMode): EditorState {
  const fields = toFields(mode === "create" ? null : item);
  const version = mode === "edit" && item && isUsableVersion(item.version) ? item.version : null;
  return {
    mode,
    itemId: mode === "edit" ? item?.id ?? null : null,
    draft: fields,
    base: fields,
    version,
    versionProblem: mode === "edit" && Boolean(item) && version === null,
    updatedAt: mode === "edit" ? item?.updatedAt : undefined,
    status: "idle",
    message: null,
    info: null,
    sideMessage: null,
    conflictAcknowledged: false,
    generation: 0,
    pending: null,
    unknown: null,
  };
}

// --- Derived values -----------------------------------------------------------------------------------------------------------

/** Controls are disabled while a request is in flight, so a draft can not change under it (a reload must never overwrite later edits). */
export const isLocked = (state: EditorState) => state.status === "saving" || state.status === "reloading";

export const isDirty = (state: EditorState) => !fieldsEqual(state.draft, state.base);

/** Whether a new save may be started. Never for a stale baseline, an unknown outcome, a missing item, an in-flight request or a missing version. */
export function canSave(state: EditorState): boolean {
  if (state.status === "saving" || state.status === "reloading" || state.status === "unknown" || state.status === "stale" || state.status === "missing") return false;
  if (state.mode === "create") return true;
  return !state.versionProblem && state.version !== null && state.itemId !== null;
}

export function statusBadgeLabel(state: EditorState): string {
  const create = state.mode === "create";
  switch (state.status) {
    case "saved": return create ? "Created" : "Saved";
    case "saving": return create ? "Creating" : "Saving";
    case "stale": return "Conflict";
    case "unknown": return "Unconfirmed";
    case "reloading": return "Loading";
    case "error":
    case "unauthorized":
    case "missing": return "Error";
    default: return create ? "New item" : "Not synced";
  }
}

/** Text for the polite status live region. Errors and conflicts are announced by their own role="alert" elements instead. */
export function liveMessage(state: EditorState): string {
  const create = state.mode === "create";
  if (state.status === "saving") return create ? "Creating…" : "Saving…";
  if (state.status === "reloading") return "Loading the latest version…";
  if (state.status === "saved") return state.info ?? (create ? "Created." : "Saved.");
  return state.info ?? "";
}

// --- Reducer ------------------------------------------------------------------------------------------------------------------

const isDateLike = (value: unknown): value is string | Date | null => value === null || typeof value === "string" || value instanceof Date;

function finishSave(state: EditorState, pending: PendingRequest, outcome: SaveOutcome | CreateOutcome): EditorState {
  const settled = { ...state, pending: null, info: null };
  switch (outcome.kind) {
    case "saved": {
      // Adopt the server's version and updatedAt for THIS item (the request layer already checked the id). The draft is untouched; the
      // baseline becomes exactly what was submitted.
      const updatedAt = isDateLike(outcome.item.updatedAt) ? outcome.item.updatedAt : state.updatedAt;
      return { ...settled, status: "saved", message: null, version: outcome.item.version, updatedAt, base: pending.snapshot, unknown: null, conflictAcknowledged: false };
    }
    case "created":
      return { ...settled, status: "saved", message: null, base: pending.snapshot, unknown: null };
    case "stale":
      // Nothing was written. Keep the draft and the OLD token; saving is blocked until the user loads the latest version.
      return { ...settled, status: "stale", message: null, conflictAcknowledged: false, unknown: null };
    case "conflict":
      return { ...settled, status: "error", message: MESSAGES.nameConflict, unknown: null };
    case "notFound":
      return { ...settled, status: "missing", message: MESSAGES.notFound, unknown: null };
    case "unauthorized":
      return { ...settled, status: "unauthorized", message: MESSAGES.unauthorized, unknown: null };
    case "unknown":
      if (state.mode === "create") return { ...settled, status: "error", message: MESSAGES.createUnknown };
      // May have been applied: keep the exact snapshot and token for an identical retry or a check of the latest state.
      return pending.version === null ? { ...settled, status: "error", message: MESSAGES.editFailed } : { ...settled, status: "unknown", message: null, unknown: { snapshot: pending.snapshot, version: pending.version } };
    case "badVersion":
      return { ...settled, status: "error", message: MESSAGES.versionProblem };
    case "invalid":
    case "rejected":
    case "failed":
      return { ...settled, status: "error", message: state.mode === "create" ? MESSAGES.createFailed : MESSAGES.editFailed, unknown: null };
  }
}

function finishReload(state: EditorState, pending: PendingRequest, outcome: LoadOutcome): EditorState {
  const settled = { ...state, pending: null, info: null };
  switch (outcome.kind) {
    case "loaded": {
      const item = outcome.item;
      if (pending.kind === "reload") {
        // Explicit, confirmed replacement: the draft, the baseline and the token all come from the server item.
        const fields = toFields(item);
        return { ...settled, draft: fields, base: fields, version: item.version ?? null, versionProblem: false, updatedAt: item.updatedAt, status: "idle", message: null, info: MESSAGES.loaded, conflictAcknowledged: false, unknown: null };
      }
      // "check": decide what happened to the unconfirmed save. The draft is never replaced here.
      const sent = state.unknown;
      if (!sent) return { ...settled, status: pending.returnTo };
      // A newer server version is adopted ONLY with strong evidence that THIS operation committed: exactly one write since the version we
      // sent (a committed save increments the version by exactly one) AND every submitted field reads back identically. Matching fields
      // alone are not enough (several writes may have happened, and a stale or clamped/normalized field means the persisted form differs
      // from the submitted one, e.g. a blank hot score, which the server does not apply). Anything ambiguous is "stale": the draft is
      // kept and the user recovers explicitly.
      if (item.version === sent.version + 1 && fieldsEqual(toFields(item), sent.snapshot)) {
        return { ...settled, status: "saved", message: null, info: MESSAGES.adopted, version: item.version ?? sent.version, updatedAt: item.updatedAt, base: sent.snapshot, unknown: null };
      }
      if (item.version === sent.version) return { ...settled, status: "idle", message: null, info: MESSAGES.notApplied, unknown: null };
      return { ...settled, status: "stale", message: null, conflictAcknowledged: false, unknown: null };
    }
    case "notFound":
      return { ...settled, status: "missing", message: MESSAGES.notFound, unknown: null };
    case "unauthorized":
      return { ...settled, status: pending.returnTo, message: MESSAGES.unauthorized };
    case "malformed":
      return { ...settled, status: pending.returnTo, message: MESSAGES.reloadMalformed };
    case "failed":
      return { ...settled, status: pending.returnTo, message: MESSAGES.reloadFailed };
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "edit": {
      // Locked while a request is in flight. Otherwise the draft changes, and a stale/unknown/unauthorized/missing status is KEPT:
      // typing must never clear a conflict. Only an ordinary result (saved/error/idle) falls back to idle.
      if (isLocked(state)) return state;
      const draft = { ...state.draft, [action.key]: action.value };
      return state.status === "saved" || state.status === "error" || state.status === "idle" ? { ...state, draft, status: "idle", message: null, info: null, sideMessage: null } : { ...state, draft, sideMessage: null };
    }
    case "localInvalid":
      // An ordinary state shows the message as before. In any state that carries meaning of its own (a conflict, an unconfirmed save, a
      // missing item, an authorization failure, a request in flight) the message is kept SEPARATE and the status is left alone.
      return state.status === "idle" || state.status === "saved" || state.status === "error"
        ? { ...state, status: "error", message: action.message, info: null, sideMessage: null }
        : { ...state, sideMessage: action.message };
    case "saveStarted":
      if (!canSave(state)) return state;
      return { ...state, status: "saving", message: null, info: null, sideMessage: null, generation: action.generation, pending: { generation: action.generation, kind: "save", snapshot: action.snapshot, version: state.version, returnTo: state.status } };
    case "retryStarted":
      if (state.status !== "unknown" || !state.unknown) return state;
      return { ...state, status: "saving", message: null, info: null, generation: action.generation, pending: { generation: action.generation, kind: "save", snapshot: state.unknown.snapshot, version: state.unknown.version, returnTo: "unknown" } };
    case "saveFinished": {
      const pending = state.pending;
      if (!pending || pending.kind !== "save" || pending.generation !== action.generation) return state;   // a late or superseded response
      return finishSave(state, pending, action.outcome);
    }
    case "keepEditing":
      return state.status === "stale" ? { ...state, conflictAcknowledged: true } : state;
    case "reloadStarted": {
      const allowed = (action.intent === "reload" && state.status === "stale") || (action.intent === "check" && state.status === "unknown" && state.unknown !== null);
      if (!allowed) return state;
      const snapshot = action.intent === "check" && state.unknown ? state.unknown.snapshot : state.draft;
      return { ...state, status: "reloading", message: null, info: null, generation: action.generation, pending: { generation: action.generation, kind: action.intent, snapshot, version: state.version, returnTo: state.status } };
    }
    case "reloadFinished": {
      const pending = state.pending;
      if (!pending || (pending.kind !== "reload" && pending.kind !== "check") || pending.generation !== action.generation) return state;   // late or superseded
      return finishReload(state, pending, action.outcome);
    }
  }
}
