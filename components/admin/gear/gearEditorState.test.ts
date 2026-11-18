import assert from "node:assert/strict";
import test from "node:test";
import { toFields, type EditableFields } from "./gearEditorModel";
import type { SaveOutcome } from "./gearEditorRequests";
import { canSave, createEditorState, editorReducer, isDirty, isLocked, liveMessage, MESSAGES, statusBadgeLabel, type EditorAction, type EditorState } from "./gearEditorState";
import { gearItem } from "./gearEditorTestKit";

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);
const fresh = (item = gearItem()) => createEditorState(item, "edit");
const draftOf = (state: EditorState): EditableFields => state.draft;
const savedOutcome = (version = 4): SaveOutcome => ({ kind: "saved", item: { id: "g1", version, updatedAt: "2026-02-01T00:00:00.000Z" } });

/** An edited draft that is in flight as save generation 1. */
function saving() {
  const edited = run(fresh(), { type: "edit", key: "name", value: "Edited" });
  return run(edited, { type: "saveStarted", generation: 1, snapshot: { ...edited.draft } });
}

test("initial state captures the item's id, draft, baseline and version once", () => {
  const state = fresh();
  assert.deepEqual([state.itemId, state.version, state.versionProblem, state.status, state.updatedAt], ["g1", 3, false, "idle", "2026-01-02T00:00:00.000Z"]);
  assert.deepEqual(state.draft, toFields(gearItem()));
  assert.equal(state.draft, state.base);
  assert.equal(isDirty(state), false);
  assert.equal(canSave(state), true);
});

test("a missing or malformed version disables saving in edit mode; create mode needs none", () => {
  for (const version of [undefined, null, "3" as unknown as number, -1, 1.5, 2_147_483_648, Number.NaN]) {
    const state = createEditorState(gearItem({ version }), "edit");
    assert.equal(state.version, null, String(version));
    assert.equal(state.versionProblem, true);
    assert.equal(canSave(state), false);
  }
  const create = createEditorState(null, "create");
  assert.deepEqual([create.itemId, create.version, create.versionProblem, canSave(create)], [null, null, false, true]);
});

test("editing changes the draft, makes it dirty and falls back to idle after a result; the token never changes", () => {
  const state = run(fresh(), { type: "edit", key: "name", value: "New name" });
  assert.equal(state.draft.name, "New name");
  assert.equal(state.base.name, "Trail Tee");
  assert.equal(isDirty(state), true);
  assert.equal(state.version, 3);
  const afterError = run(state, { type: "localInvalid", message: "bad" }, { type: "edit", key: "name", value: "x" });
  assert.deepEqual([afterError.status, afterError.message], ["idle", null], "ordinary results are cleared by editing, as before");
});

test("a successful save adopts the returned version for this item and makes the submitted draft the baseline; the next save uses the new version", () => {
  const start = saving();
  assert.deepEqual([start.status, isLocked(start), canSave(start)], ["saving", true, false]);
  const done = run(start, { type: "saveFinished", generation: 1, outcome: savedOutcome(4) });
  assert.deepEqual([done.status, done.version, done.updatedAt, isDirty(done), canSave(done)], ["saved", 4, "2026-02-01T00:00:00.000Z", false, true]);
  assert.equal(done.pending, null);
  const second = run(done, { type: "edit", key: "name", value: "Second" }, { type: "saveStarted", generation: 2, snapshot: { ...done.draft, name: "Second" } });
  assert.equal(second.pending?.version, 4, "the second save is conditioned on the NEW version");
});

test("a stale conflict keeps the draft and the OLD token, blocks saving, and is not cleared by typing or by Keep editing", () => {
  const stale = run(saving(), { type: "saveFinished", generation: 1, outcome: { kind: "stale" } });
  assert.deepEqual([stale.status, stale.version, stale.draft.name, canSave(stale), isLocked(stale)], ["stale", 3, "Edited", false, false]);
  const typing = run(stale, { type: "edit", key: "subcategory", value: "more" });
  assert.deepEqual([typing.status, typing.draft.subcategory, typing.version], ["stale", "more", 3], "typing keeps the conflict and the draft");
  const kept = run(typing, { type: "keepEditing" });
  assert.deepEqual([kept.status, kept.conflictAcknowledged, canSave(kept)], ["stale", true, false], "Keep editing retains the stale status; Save stays disabled");
  assert.equal(run(fresh(), { type: "keepEditing" }).conflictAcknowledged, false, "only meaningful in the stale state");
});

test("every other failure keeps the draft and the token, with its own status and message", () => {
  const cases: Array<[SaveOutcome, string, string | null, boolean]> = [
    [{ kind: "conflict" }, "error", MESSAGES.nameConflict, true],
    [{ kind: "invalid" }, "error", MESSAGES.editFailed, true],
    [{ kind: "rejected" }, "error", MESSAGES.editFailed, true],
    [{ kind: "notFound" }, "missing", MESSAGES.notFound, false],
    [{ kind: "unauthorized", status: 401 }, "unauthorized", MESSAGES.unauthorized, true],
    [{ kind: "unauthorized", status: 403 }, "unauthorized", MESSAGES.unauthorized, true],
  ];
  for (const [outcome, status, message, saveable] of cases) {
    const after = run(saving(), { type: "saveFinished", generation: 1, outcome });
    assert.deepEqual([after.status, after.message, after.draft.name, after.version, canSave(after)], [status, message, "Edited", 3, saveable], outcome.kind);
  }
  assert.notEqual(MESSAGES.nameConflict, MESSAGES.editFailed);
});

test("an unknown outcome keeps the exact submitted snapshot and token, blocks a normal save, and still lets the draft be edited", () => {
  const unknown = run(saving(), { type: "saveFinished", generation: 1, outcome: { kind: "unknown", reason: "network" } });
  assert.equal(unknown.status, "unknown");
  assert.deepEqual([unknown.unknown?.version, unknown.unknown?.snapshot.name, canSave(unknown), isLocked(unknown)], [3, "Edited", false, false]);
  const edited = run(unknown, { type: "edit", key: "name", value: "Edited again" });
  assert.deepEqual([edited.status, edited.unknown?.snapshot.name, edited.draft.name], ["unknown", "Edited", "Edited again"], "the stored snapshot is not the (edited) draft");
  const retry = run(edited, { type: "retryStarted", generation: 2 });
  assert.deepEqual([retry.status, retry.pending?.version, retry.pending?.snapshot.name], ["saving", 3, "Edited"], "a retry carries the identical snapshot and the identical token");
});

test("late, superseded and orphaned responses are ignored", () => {
  const start = saving();
  assert.equal(run(start, { type: "saveFinished", generation: 99, outcome: savedOutcome(9) }), start, "wrong generation");
  assert.equal(run(fresh(), { type: "saveFinished", generation: 1, outcome: savedOutcome(9) }).version, 3, "nothing pending");
  const finished = run(start, { type: "saveFinished", generation: 1, outcome: { kind: "stale" } });
  assert.equal(run(finished, { type: "saveFinished", generation: 1, outcome: savedOutcome(9) }), finished, "a duplicate response after completion");
  const reloading = run(finished, { type: "reloadStarted", generation: 2, intent: "reload" });
  assert.equal(run(reloading, { type: "saveFinished", generation: 2, outcome: savedOutcome(9) }), reloading, "a save response can not complete a reload");
  assert.equal(run(start, { type: "reloadFinished", generation: 1, outcome: { kind: "failed" } }), start, "a reload response can not complete a save");
});

test("while a request is in flight the draft is locked, so a reload can never overwrite later edits and a save can not start twice", () => {
  const start = saving();
  assert.equal(run(start, { type: "edit", key: "name", value: "late" }), start, "editing is ignored while saving");
  assert.equal(run(start, { type: "saveStarted", generation: 2, snapshot: start.draft }), start, "no second save");
  const stale = run(start, { type: "saveFinished", generation: 1, outcome: { kind: "stale" } });
  const reloading = run(stale, { type: "reloadStarted", generation: 2, intent: "reload" });
  assert.deepEqual([reloading.status, isLocked(reloading)], ["reloading", true]);
  assert.equal(run(reloading, { type: "edit", key: "name", value: "late" }), reloading);
});

test("load latest replaces the draft, baseline and token only after a successful, validated result", () => {
  const stale = run(saving(), { type: "saveFinished", generation: 1, outcome: { kind: "stale" } });
  const latest = gearItem({ name: "Server name", version: 7, updatedAt: "2026-05-01T00:00:00.000Z" });
  const reloading = run(stale, { type: "reloadStarted", generation: 2, intent: "reload" });
  assert.deepEqual([reloading.draft.name, reloading.version], ["Edited", 3], "nothing is replaced when the request starts");
  const loaded = run(reloading, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item: latest } });
  assert.deepEqual([loaded.status, loaded.draft.name, loaded.base.name, loaded.version, loaded.updatedAt, isDirty(loaded), canSave(loaded), loaded.info], ["idle", "Server name", "Server name", 7, "2026-05-01T00:00:00.000Z", false, true, MESSAGES.loaded]);
  assert.equal(run(fresh(), { type: "reloadStarted", generation: 1, intent: "reload" }).status, "idle", "load latest is only offered from the stale state");
});

test("a failed, malformed, unauthorized or missing reload preserves the draft and returns to the stale state (or the missing state)", () => {
  const stale = run(saving(), { type: "saveFinished", generation: 1, outcome: { kind: "stale" } });
  for (const [outcome, status, message] of [
    [{ kind: "failed" }, "stale", MESSAGES.reloadFailed],
    [{ kind: "malformed" }, "stale", MESSAGES.reloadMalformed],
    [{ kind: "unauthorized", status: 401 }, "stale", MESSAGES.unauthorized],
    [{ kind: "notFound" }, "missing", MESSAGES.notFound],
  ] as const) {
    const after = run(stale, { type: "reloadStarted", generation: 2, intent: "reload" }, { type: "reloadFinished", generation: 2, outcome });
    assert.deepEqual([after.status, after.message, after.draft.name, after.version, canSave(after)], [status, message, "Edited", 3, false], outcome.kind);
  }
});

test("checking the latest state after an unknown outcome: adopt only if the server holds exactly what was submitted; never silently use a newer token", () => {
  const unknown = run(saving(), { type: "saveFinished", generation: 1, outcome: { kind: "unknown", reason: "network" } });
  const submitted = { ...gearItem(), name: "Edited", version: 4 };
  const start = run(unknown, { type: "reloadStarted", generation: 2, intent: "check" });
  const adopted = run(start, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item: submitted } });
  assert.deepEqual([adopted.status, adopted.version, adopted.info, isDirty(adopted), adopted.unknown], ["saved", 4, MESSAGES.adopted, false, null], "the save had been applied");

  const notApplied = run(start, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item: gearItem({ version: 3 }) } });
  assert.deepEqual([notApplied.status, notApplied.version, notApplied.draft.name, notApplied.info, canSave(notApplied)], ["idle", 3, "Edited", MESSAGES.notApplied, true], "unchanged on the server: the draft is kept and the OLD token still applies");

  const changed = run(start, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item: gearItem({ name: "Someone else", version: 9 }) } });
  assert.deepEqual([changed.status, changed.version, changed.draft.name, canSave(changed)], ["stale", 3, "Edited", false], "someone else changed it: stale, the OLD token is kept, nothing adopted");

  const failed = run(start, { type: "reloadFinished", generation: 2, outcome: { kind: "failed" } });
  assert.deepEqual([failed.status, failed.unknown?.version, failed.message], ["unknown", 3, MESSAGES.reloadFailed], "a failed check leaves the unconfirmed save available for a deliberate retry");
});

test("create mode: saving needs no version, success makes the draft the baseline, unknown is an error, and the status labels are unchanged", () => {
  const create = createEditorState(null, "create");
  const typed = run(create, { type: "edit", key: "name", value: "New" });
  assert.equal(isDirty(typed), true);
  const created = run(typed, { type: "saveStarted", generation: 1, snapshot: { ...typed.draft } }, { type: "saveFinished", generation: 1, outcome: { kind: "created", item: { id: "n1" } } });
  assert.deepEqual([created.status, isDirty(created), statusBadgeLabel(created)], ["saved", false, "Created"]);
  const unknown = run(typed, { type: "saveStarted", generation: 1, snapshot: { ...typed.draft } }, { type: "saveFinished", generation: 1, outcome: { kind: "unknown" } });
  assert.deepEqual([unknown.status, unknown.message, unknown.unknown], ["error", MESSAGES.createUnknown, null]);
  const failed = run(typed, { type: "saveStarted", generation: 1, snapshot: { ...typed.draft } }, { type: "saveFinished", generation: 1, outcome: { kind: "failed" } });
  assert.equal(failed.message, MESSAGES.createFailed);
  assert.deepEqual([statusBadgeLabel(create), statusBadgeLabel(fresh()), statusBadgeLabel(saving()), liveMessage(saving())], ["New item", "Not synced", "Saving", "Saving…"]);
});

test("a late reload or save response can never silently clear a conflict: only an explicit result changes the stale state", () => {
  const stale = run(saving(), { type: "saveFinished", generation: 1, outcome: { kind: "stale" } });
  for (const action of [{ type: "saveFinished", generation: 1, outcome: savedOutcome(8) }, { type: "reloadFinished", generation: 1, outcome: { kind: "failed" } }, { type: "edit", key: "name", value: "x" }, { type: "keepEditing" }] as const) {
    assert.equal(run(stale, action).status, "stale", action.type);
  }
  assert.equal(draftOf(stale).name, "Edited");
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Final-verification additions
// ---------------------------------------------------------------------------------------------------------------------------------

test("an unrelated failure message (brand creation, delete) can never clear or replace a conflict, an unconfirmed save, a missing item or an in-flight request", () => {
  const stale = run(saving(), { type: "saveFinished", generation: 1, outcome: { kind: "stale" } });
  const unknown = run(saving(), { type: "saveFinished", generation: 1, outcome: { kind: "unknown", reason: "network" } });
  const missing = run(saving(), { type: "saveFinished", generation: 1, outcome: { kind: "notFound" } });
  const unauthorized = run(saving(), { type: "saveFinished", generation: 1, outcome: { kind: "unauthorized", status: 401 } });
  const reloading = run(stale, { type: "reloadStarted", generation: 2, intent: "reload" });
  for (const [label, state] of [["stale", stale], ["unknown", unknown], ["missing", missing], ["unauthorized", unauthorized], ["saving", saving()], ["reloading", reloading]] as const) {
    const after = run(state, { type: "localInvalid", message: "Brand creation failed." });
    assert.equal(after.status, state.status, `${label}: the status is untouched`);
    assert.equal(canSave(after), canSave(state), `${label}: Save availability is untouched`);
    assert.equal(after.message, state.message, `${label}: the conflict's own message is untouched`);
    assert.equal(after.sideMessage, "Brand creation failed.", `${label}: the unrelated message is shown separately`);
    assert.equal(after.version, state.version);
    assert.equal(after.draft, state.draft);
  }
  // In an ordinary state it behaves as before.
  const ordinary = run(fresh(), { type: "localInvalid", message: "Name is required." });
  assert.deepEqual([ordinary.status, ordinary.message, ordinary.sideMessage], ["error", "Name is required.", null]);
  // The separate message goes away on the next edit, and never touches the conflict.
  const afterEdit = run(run(stale, { type: "localInvalid", message: "x" }), { type: "edit", key: "name", value: "y" });
  assert.deepEqual([afterEdit.status, afterEdit.sideMessage], ["stale", null]);
});

test("check latest adopts a newer server version ONLY with strong evidence: exactly one write since, and every submitted field round-trips exactly", () => {
  const unknown = run(saving(), { type: "saveFinished", generation: 1, outcome: { kind: "unknown", reason: "network" } });   // submitted name "Edited" with token 3
  const start = run(unknown, { type: "reloadStarted", generation: 2, intent: "check" });
  const check = (item: ReturnType<typeof gearItem>) => run(start, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item } });

  const exactlyOne = check(gearItem({ name: "Edited", version: 4 }));
  assert.deepEqual([exactlyOne.status, exactlyOne.version], ["saved", 4], "one write since, all fields identical: adopted");

  for (const version of [5, 6, 9]) {
    const jumped = check(gearItem({ name: "Edited", version }));
    assert.deepEqual([jumped.status, jumped.version, jumped.draft.name, canSave(jumped)], ["stale", 3, "Edited", false], `version ${version}: matching fields are NOT enough when more than one write happened`);
  }
  const different = check(gearItem({ name: "Someone else", version: 4 }));
  assert.deepEqual([different.status, different.version], ["stale", 3], "one write since but different content: not ours");
});

test("check latest never adopts when a submitted field does not round-trip: weatherSuitability.hot cleared (blank) while the server still holds a score", () => {
  // The editor sends a blank hot score as `hot: null`, which the server does not apply (existing behavior, untouched here). So a COMMITTED save
  // whose hot field was blank leaves the old score on the server: the persisted form differs from the submitted one.
  const edited = run(fresh(), { type: "edit", key: "name", value: "Edited" }, { type: "edit", key: "weatherHot", value: "" });
  const unknown = run(run(edited, { type: "saveStarted", generation: 1, snapshot: { ...edited.draft } }), { type: "saveFinished", generation: 1, outcome: { kind: "unknown", reason: "network" } });
  const start = run(unknown, { type: "reloadStarted", generation: 2, intent: "check" });
  const afterCommit = run(start, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item: gearItem({ name: "Edited", weatherHot: 0.4, version: 4 }) } });
  assert.deepEqual([afterCommit.status, afterCommit.version, afterCommit.draft.weatherHot, canSave(afterCommit)], ["stale", 3, "", false], "ambiguous evidence: the draft is kept and the user must recover explicitly");
  // When the representations really do match, the same exact-one-write rule adopts.
  const matching = run(start, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item: gearItem({ name: "Edited", weatherHot: null, version: 4 }) } });
  assert.equal(matching.status, "saved");
});

test("check latest does not adopt through representation differences: whitespace, case, clamped scores and untrimmed values stay ambiguous", () => {
  const cases: Array<[keyof EditableFields, string, Parameters<typeof gearItem>[0]]> = [
    ["name", "  Edited  ", { name: "Edited" }],                 // the server trims
    ["tags", "Light, Trail", { tags: ["light", "trail"] }],     // the server lower-cases tags
    ["weatherCold", "2", { weatherCold: 1 }],                    // the editor clamps to 0..1
    ["affiliateUrl", " https://shop.example.com/a ", { affiliateUrl: "https://shop.example.com/a" }],
  ];
  for (const [key, typed, server] of cases) {
    const edited = run(fresh(), { type: "edit", key, value: typed });
    const unknown = run(run(edited, { type: "saveStarted", generation: 1, snapshot: { ...edited.draft } }), { type: "saveFinished", generation: 1, outcome: { kind: "unknown", reason: "network" } });
    const result = run(unknown, { type: "reloadStarted", generation: 2, intent: "check" }, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item: gearItem({ ...server, version: 4 }) } });
    assert.deepEqual([result.status, result.version, result.draft[key]], ["stale", 3, typed], `${key}: not adopted, draft kept`);
  }
});
