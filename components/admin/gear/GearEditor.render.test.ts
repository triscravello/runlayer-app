import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GearEditor } from "./GearEditor";
import { GearConflictNotice, GearEditorNotices, GearUnknownOutcomeNotice } from "./GearEditorNotices";
import { createEditorState, editorReducer, MESSAGES, type EditorAction, type EditorState } from "./gearEditorState";
import { gearItem } from "./gearEditorTestKit";

// Static-markup tests (no DOM library): the editor's initial render, and every notice the editor can show. Effects do not run in static
// rendering, so these check what the first render commits: structure, ARIA, and enabled/disabled controls.

const noop = () => undefined;
const handlers = { onKeepEditing: noop, onLoadLatest: noop, onRetry: noop, onCheckLatest: noop };
const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);
const notices = (state: EditorState) => renderToStaticMarkup(createElement(GearEditorNotices, { state, ...handlers }));
// The Button's Tailwind classes contain "disabled:" variants, so only the real attribute counts.
const isDisabled = (element: string | null) => element !== null && /\sdisabled=""/.test(element);
const button = (markup: string, label: string) => markup.match(new RegExp(`<button[^>]*>${label.replace(/[.*+?^${}()|[\]\\…]/g, "\\$&")}</button>`))?.[0] ?? null;

function inFlightSave() {
  const edited = run(createEditorState(gearItem(), "edit"), { type: "edit", key: "name", value: "Mine" });
  return run(edited, { type: "saveStarted", generation: 1, snapshot: { ...edited.draft } });
}
const stale = () => run(inFlightSave(), { type: "saveFinished", generation: 1, outcome: { kind: "stale" } });
const unknown = () => run(inFlightSave(), { type: "saveFinished", generation: 1, outcome: { kind: "unknown", reason: "network" } });

test("a valid item renders an enabled Save, a live status region, a fieldset for in-flight locking and no alerts", () => {
  const markup = renderToStaticMarkup(createElement(GearEditor, { item: gearItem(), mode: "edit" }));
  assert.match(markup, /<fieldset[^>]*class="[^"]*"[^>]*>/);
  assert.equal(/<fieldset[^>]*\sdisabled=""/.test(markup), false, "the form is not locked when nothing is in flight");
  assert.match(markup, /role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
  const save = button(markup, "Save Changes");
  assert.ok(save, "the Save button is rendered");
  assert.equal(isDisabled(save), false, "and enabled");
  assert.equal(markup.includes('role="alert"'), false, "no alert on a clean editor");
  assert.match(markup, /Not synced/);
});

test("a missing or malformed version renders an alert and a disabled Save: it never falls back to an unconditional save", () => {
  for (const version of [undefined, null, "3" as unknown as number, -1, 1.5, 2_147_483_648]) {
    const markup = renderToStaticMarkup(createElement(GearEditor, { item: gearItem({ version }), mode: "edit" }));
    assert.match(markup, /role="alert"[^>]*data-notice="version-problem"|data-notice="version-problem"[^>]*role="alert"/, String(version));
    assert.ok(markup.includes("version is missing or invalid") || markup.includes(MESSAGES.versionProblem.slice(0, 20)));
    const save = button(markup, "Save Changes");
    assert.ok(save && isDisabled(save), `Save is disabled for version ${String(version)}`);
  }
});

test("create mode is unchanged: Create Gear is enabled, there is no version alert and no expectedVersion concept", () => {
  const markup = renderToStaticMarkup(createElement(GearEditor, { item: null, mode: "create" }));
  const create = button(markup, "Create Gear");
  assert.ok(create && !isDisabled(create));
  assert.equal(markup.includes('role="alert"'), false);
  assert.match(markup, /New item/);
  assert.equal(markup.includes("version-problem"), false);
});

test("the stale-conflict notice is an alert, explains that the draft is kept, and offers exactly Keep editing and Load latest (no overwrite)", () => {
  const markup = notices(stale());
  assert.match(markup, /role="alert"/);
  assert.match(markup, /data-notice="stale-conflict"/);
  assert.match(markup, /changed by someone else/);
  assert.match(markup, /Your edits are still here and have not been sent/);
  const keep = button(markup, "Keep editing");
  const load = button(markup, "Load latest version…");
  assert.ok(keep && load, "both recovery actions are real buttons");
  assert.equal(isDisabled(keep) || isDisabled(load), false, "and both are enabled");
  assert.ok(keep.includes('type="button"') && load.includes('type="button"'), "they never submit a form");
  assert.equal(/overwrite|force|save anyway|save over/i.test(markup), false, "no force-overwrite action is offered");
  assert.equal((markup.match(/<button/g) ?? []).length, 2, "and nothing else is clickable in the notice");
  // The description the buttons and the alert point at exists.
  assert.match(markup, /aria-describedby="gear-conflict-detail"/);
  assert.match(markup, /id="gear-conflict-detail"/);
});

test("after Keep editing the notice stays (it is still a conflict) but only Load latest remains, and the text says saving stays off", () => {
  const markup = notices(run(stale(), { type: "keepEditing" }));
  assert.match(markup, /role="alert"/);
  assert.equal(button(markup, "Keep editing"), null);
  assert.ok(button(markup, "Load latest version…"));
  assert.match(markup, /Saving stays off/);
});

test("while a reload is running the recovery buttons are disabled", () => {
  const reloading = run(stale(), { type: "reloadStarted", generation: 2, intent: "reload" });
  const markup = renderToStaticMarkup(createElement(GearConflictNotice, { acknowledged: false, busy: true, onKeepEditing: noop, onLoadLatest: noop }));
  assert.ok(isDisabled(button(markup, "Load latest version…")));
  assert.equal(reloading.status, "reloading");
  assert.equal(notices(reloading).includes("stale-conflict"), false, "the conflict notice is replaced while reloading; the live region announces the progress");
});

test("the unknown-outcome notice is an alert offering a same-token retry and a deliberate check, with the draft kept", () => {
  const markup = notices(unknown());
  assert.match(markup, /role="alert"/);
  assert.match(markup, /data-notice="unknown-outcome"/);
  assert.match(markup, /couldn&#x27;t confirm whether your save was applied|couldn&apos;t confirm whether your save was applied|couldn(&#x27;|&apos;|')t confirm whether your save was applied/);
  assert.ok(button(markup, "Retry the same save"));
  assert.ok(button(markup, "Check latest"));
  assert.match(markup, /exactly the same request/);
  assert.match(markup, /Your edits are kept/);
  const disabled = renderToStaticMarkup(createElement(GearUnknownOutcomeNotice, { busy: true, onRetry: noop, onCheckLatest: noop }));
  assert.ok(isDisabled(button(disabled, "Retry the same save")) && isDisabled(button(disabled, "Check latest")));
});

test("errors are alerts with their own text; informational results are a polite status; neither is shown for a clean editor", () => {
  const conflict = run(inFlightSave(), { type: "saveFinished", generation: 1, outcome: { kind: "conflict" } });
  const markup = notices(conflict);
  assert.match(markup, /role="alert"[^>]*data-notice="error"|data-notice="error"[^>]*role="alert"/);
  assert.ok(markup.includes("Another gear item already uses this name and brand"));
  assert.equal(markup.includes("stale-conflict"), false, "a name conflict is not shown as a stale conflict");

  const unauthorized = notices(run(inFlightSave(), { type: "saveFinished", generation: 1, outcome: { kind: "unauthorized", status: 401 } }));
  assert.ok(unauthorized.includes("not signed in as an administrator") && unauthorized.includes("Your edits are still in the form"));

  const loaded = notices(run(stale(), { type: "reloadStarted", generation: 2, intent: "reload" }, { type: "reloadFinished", generation: 2, outcome: { kind: "loaded", item: gearItem({ version: 8 }) } }));
  assert.match(loaded, /role="status"[^>]*data-notice="info"|data-notice="info"[^>]*role="status"/);
  assert.equal(notices(createEditorState(gearItem(), "edit")), "", "nothing at all for a clean editor");
});

test("an unrelated failure message is shown as its own alert beside, never instead of, the conflict notice", () => {
  const withSide = run(stale(), { type: "localInvalid", message: "Brand creation failed. Check the brand name and try again." });
  const markup = notices(withSide);
  assert.match(markup, /data-notice="stale-conflict"/, "the conflict is still shown");
  assert.match(markup, /data-notice="side-error"/);
  assert.ok(markup.includes("Brand creation failed."));
  assert.ok(button(markup, "Load latest version…") && button(markup, "Keep editing"), "and its recovery actions are still there");
  assert.equal(markup.match(/role="alert"/g)?.length, 2, "two separate alerts");
});

test("the editor is wired to the state model, the dirty-state report and the in-flight lock (a structural check, since there is no DOM test library)", () => {
  const source = readFileSync(fileURLToPath(new URL("./GearEditor.tsx", import.meta.url)), "utf8");
  assert.match(source, /useReducer\(editorReducer, undefined, \(\) => createEditorState\(item, mode\)\)/, "all draft, version and conflict state lives in the reducer, captured from the item once");
  assert.match(source, /useEffect\(\(\) => \{ dirtyCallbackRef\.current\?\.\(dirty\); \}, \[dirty\]\)/, "dirty changes are reported to the catalog");
  assert.match(source, /return \(\) => report\.current\?\.\(false\)/, "and cleared when the editor unmounts");
  assert.match(source, /<fieldset disabled=\{isLocked\(state\)\}/, "controls are disabled while a request is in flight");
  assert.match(source, /disabled=\{!canSave\(state\)\}/, "Save follows canSave (stale, unknown, missing and in-flight states disable it)");
  assert.match(source, /getController\(\)\.save\(\)/, "Save goes through the controller");
  assert.equal(/"PATCH"|'PATCH'/.test(source), false, "the editor no longer builds its own PATCH request (DELETE and brand creation are unchanged)");
  assert.equal(/expectedVersion/.test(source), false, "the token is added only by the request layer, never by the component");
});
