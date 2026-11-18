import type { EditorState } from "./gearEditorState";

// Focus policy for the admin gear editor, as pure functions (no DOM, no React) so the decisions can be tested deterministically.
//
// Why this exists: the editor locks itself with a <fieldset disabled> while a request is in flight, and the recovery buttons come and go
// as the status changes. A browser drops focus to <body> when the focused control is disabled or removed, so without help a keyboard user
// has to start over from the top of the page after every save, conflict or reload.
//
// The policy only ever RESTORES focus after a real status transition. It never runs on mount, never runs for ordinary typing, never
// moves focus away from a control the user has legitimately focused, and never targets a disabled or detached element.

/** Names the elements marked with `data-focus="..."` in GearEditor and GearEditorNotices. */
export type FocusTarget = "save" | "first-field" | "conflict-primary" | "load-latest" | "retry" | "check-latest";

const inFlight = (state: EditorState) => state.status === "saving" || state.status === "reloading";

/**
 * Where focus should go after `prev` became `next`, as an ordered list of candidates (the first usable one wins), or null for "leave
 * focus alone". Only transitions that finish a request, and the "Keep editing" acknowledgement, ever return a target.
 */
export function chooseFocusTarget(prev: EditorState, next: EditorState): FocusTarget[] | null {
  if (prev === next) return null;
  // A different item or mode is a different editor: a transition across them is never ours to restore.
  if (prev.itemId !== next.itemId || prev.mode !== next.mode) return null;

  // "Keep editing" removes the button that was focused; its neighbour is the next sensible place.
  if (prev.status === "stale" && next.status === "stale" && !prev.conflictAcknowledged && next.conflictAcknowledged) return ["load-latest", "first-field"];

  // Everything else is the end of a request (the lock lifts, so focus was lost).
  if (!inFlight(prev) || inFlight(next) || prev.pending === null) return null;
  const kind = prev.pending.kind;

  switch (next.status) {
    case "saved":
      return ["save", "first-field"];
    case "error":
    case "unauthorized":
      return ["save", "first-field"];
    case "stale":
      // A save that hit a conflict starts at Keep editing. A reload that failed returns to where the user pressed: Load latest.
      return kind === "reload" ? ["load-latest", "conflict-primary", "first-field"] : ["conflict-primary", "load-latest", "first-field"];
    case "unknown":
      return kind === "check" ? ["check-latest", "retry", "first-field"] : ["retry", "check-latest", "first-field"];
    case "missing":
      return ["first-field"];
    case "idle":
      // A confirmed "Load latest" replaced the draft: start at the top of the form. A "Check latest" that found the save was not applied
      // leaves the draft saveable.
      return kind === "reload" ? ["first-field"] : ["save", "first-field"];
    default:
      return null;
  }
}

/** The part of an element the focus rules need. A real HTMLElement satisfies it (pass `matches(":disabled")` as `disabled`). */
export type FocusableLike = { isConnected: boolean; disabled?: boolean };

/** The first candidate that exists, is attached and is not disabled; null if none is usable. */
export function pickFocusTarget<T extends FocusableLike>(candidates: readonly FocusTarget[], find: (target: FocusTarget) => T | null): T | null {
  for (const candidate of candidates) {
    const element = find(candidate);
    if (element && element.isConnected && !element.disabled) return element;
  }
  return null;
}

/** What is focused right now: its tag, whether it is attached, and whether it is disabled (including by a disabled fieldset). */
export type ActiveElementLike = { tagName: string; isConnected: boolean; disabled?: boolean } | null;

/**
 * Whether focus was lost, i.e. nothing useful is focused. Only then may the editor restore it. A focused enabled control anywhere (the
 * catalog, another field, the browser's own UI) is never stolen from.
 */
export function focusWasLost(active: ActiveElementLike): boolean {
  if (active === null) return true;
  const tag = active.tagName.toUpperCase();
  return tag === "BODY" || tag === "HTML" || !active.isConnected || active.disabled === true;
}
