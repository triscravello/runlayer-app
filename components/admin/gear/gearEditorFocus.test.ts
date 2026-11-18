import assert from "node:assert/strict";
import test from "node:test";
import { chooseFocusTarget, focusWasLost, pickFocusTarget, type FocusTarget } from "./gearEditorFocus";
import { createEditorState, editorReducer, type EditorAction, type EditorState } from "./gearEditorState";
import { gearItem } from "./gearEditorTestKit";

// Pure tests of the focus POLICY (which element should get focus after which transition). They do not move real browser focus: that is a
// browser behaviour and is verified separately in a real browser, not by these tests.

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);
const fresh = () => createEditorState(gearItem(), "edit");
const edited = () => run(fresh(), { type: "edit", key: "name", value: "Mine" });
const saving = () => run(edited(), { type: "saveStarted", generation: 1, snapshot: { ...edited().draft } });
const finish = (outcome: object) => run(saving(), { type: "saveFinished", generation: 1, outcome } as EditorAction);
const stale = () => finish({ kind: "stale" });
const unknown = () => finish({ kind: "unknown", reason: "network" });
const target = (prev: EditorState, next: EditorState) => chooseFocusTarget(prev, next)?.[0] ?? null;

test("a finished save restores focus to the right control for each outcome", () => {
  const before = saving();
  assert.equal(target(before, finish({ kind: "saved", item: { id: "g1", version: 4 } })), "save");
  assert.equal(target(before, finish({ kind: "invalid" })), "save");
  assert.equal(target(before, finish({ kind: "unauthorized", status: 401 })), "save");
  assert.equal(target(before, stale()), "conflict-primary", "after a stale conflict: Keep editing");
  assert.equal(target(before, unknown()), "retry", "after an unknown outcome: Retry the same save");
  assert.equal(target(before, finish({ kind: "notFound" })), "first-field", "after a missing item: the first field");
});

test("Keep editing moves focus to Load latest (the button that was focused is gone); a second Keep editing does nothing", () => {
  const before = stale();
  const kept = run(before, { type: "keepEditing" });
  assert.deepEqual(chooseFocusTarget(before, kept), ["load-latest", "first-field"]);
  assert.equal(chooseFocusTarget(kept, run(kept, { type: "keepEditing" })), null);
});

test("a confirmed Load latest focuses the first field; a declined one changes no state, so nothing moves", () => {
  const reloading = run(stale(), { type: "reloadStarted", generation: 2, intent: "reload" });
  const loaded = run(reloading, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item: gearItem({ version: 8, name: "Server" }) } });
  assert.deepEqual(chooseFocusTarget(reloading, loaded), ["first-field"]);
  const declined = stale();
  assert.equal(chooseFocusTarget(declined, declined), null, "declining dispatches nothing: the same state object");
});

test("a failed reload returns focus to Load latest; Check latest recovery returns to the right control", () => {
  const reloading = run(stale(), { type: "reloadStarted", generation: 2, intent: "reload" });
  const failed = run(reloading, { type: "reloadFinished", generation: 2, outcome: { kind: "failed" } });
  assert.equal(failed.status, "stale");
  assert.equal(target(reloading, failed), "load-latest");

  const checking = run(unknown(), { type: "reloadStarted", generation: 2, intent: "check" });
  const notApplied = run(checking, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item: gearItem({ version: 3 }) } });
  assert.equal(notApplied.status, "idle");
  assert.equal(target(checking, notApplied), "save", "the save was not applied: the draft is saveable again");
  const checkFailed = run(checking, { type: "reloadFinished", generation: 2, outcome: { kind: "failed" } });
  assert.equal(checkFailed.status, "unknown");
  assert.equal(target(checking, checkFailed), "check-latest");
  const nowStale = run(checking, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item: gearItem({ version: 9 }) } });
  assert.equal(target(checking, nowStale), "conflict-primary");
});

test("nothing moves focus on initial mount, for ordinary typing, or while a request is merely starting", () => {
  const initial = fresh();
  assert.equal(chooseFocusTarget(initial, initial), null, "mount: the previous state is the initial state itself");
  const typed = run(initial, { type: "edit", key: "name", value: "a" }, { type: "edit", key: "name", value: "ab" });
  assert.equal(chooseFocusTarget(initial, typed), null);
  assert.equal(chooseFocusTarget(typed, run(typed, { type: "edit", key: "name", value: "abc" })), null);
  assert.equal(chooseFocusTarget(stale(), run(stale(), { type: "edit", key: "name", value: "typing in a conflict" })), null, "typing during a conflict keeps focus where it is");
  assert.equal(chooseFocusTarget(edited(), saving()), null, "starting a save moves nothing; the finish does");
  assert.equal(chooseFocusTarget(stale(), run(stale(), { type: "reloadStarted", generation: 2, intent: "reload" })), null);
});

test("a transition between different items or modes is ignored (an obsolete result never moves focus)", () => {
  const before = saving();
  const after = finish({ kind: "stale" });
  assert.ok(chooseFocusTarget(before, after));
  assert.equal(chooseFocusTarget(before, { ...after, itemId: "another" }), null);
  assert.equal(chooseFocusTarget({ ...before, mode: "create" }, after), null);
});

test("pickFocusTarget skips missing, detached and disabled candidates and returns null when none is usable", () => {
  const elements: Record<string, { isConnected: boolean; disabled?: boolean; name: string }> = {
    "conflict-primary": { isConnected: false, name: "detached" },
    "load-latest": { isConnected: true, disabled: true, name: "disabled" },
    "first-field": { isConnected: true, name: "field" },
  };
  const find = (t: FocusTarget) => elements[t] ?? null;
  assert.equal(pickFocusTarget(["retry", "conflict-primary", "load-latest", "first-field"], find)?.name, "field");
  assert.equal(pickFocusTarget(["retry", "conflict-primary", "load-latest"], find), null);
  assert.equal(pickFocusTarget([], find), null);
});

test("focus is restored only when it was lost: a focused enabled control keeps it", () => {
  assert.equal(focusWasLost(null), true);
  assert.equal(focusWasLost({ tagName: "BODY", isConnected: true }), true);
  assert.equal(focusWasLost({ tagName: "BUTTON", isConnected: false }), true, "the focused button was removed");
  assert.equal(focusWasLost({ tagName: "BUTTON", isConnected: true, disabled: true }), true, "disabled by the in-flight lock");
  assert.equal(focusWasLost({ tagName: "INPUT", isConnected: true, disabled: false }), false, "another valid control: never stolen");
  assert.equal(focusWasLost({ tagName: "A", isConnected: true }), false);
});
