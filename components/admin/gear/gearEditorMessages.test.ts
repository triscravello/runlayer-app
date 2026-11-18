import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GearEditorNotices } from "./GearEditorNotices";
import { patchGear } from "./gearEditorRequests";
import { canSave, createEditorState, editorReducer, liveMessage, MESSAGES, rejectedMessage, type EditorAction, type EditorState } from "./gearEditorState";
import { createHarness, errorBody, jsonResponse, textResponse } from "./gearEditorTestKit";

// Error classification and wording, from the HTTP response through the controller to the notice. The wording is chosen only by status and
// code; the server's body text is never displayed.

const HOSTILE = "SELECT * FROM users; <script>alert(1)</script> secret-token-abc123";
const noop = () => undefined;
const handlers = { onKeepEditing: noop, onLoadLatest: noop, onRetry: noop, onCheckLatest: noop };
const notice = (state: EditorState) => renderToStaticMarkup(createElement(GearEditorNotices, { state, ...handlers }));

async function save(response: Response | Error) {
  const h = createHarness({ responses: [response] });
  h.edit("name", "Mine");
  await h.controller.save();
  return h;
}

test("each status gets its own message through the real request layer and controller", async () => {
  const cases: Array<[string, Response | Error, string, string | null]> = [
    ["400", jsonResponse(errorBody("VALIDATION_ERROR", HOSTILE), 400), "error", MESSAGES.invalid],
    ["401", jsonResponse(errorBody("UNAUTHORIZED", HOSTILE), 401), "unauthorized", MESSAGES.unauthenticated],
    ["403", jsonResponse(errorBody("FORBIDDEN", HOSTILE), 403), "unauthorized", MESSAGES.forbidden],
    ["404", jsonResponse(errorBody("NOT_FOUND", HOSTILE), 404), "missing", MESSAGES.notFound],
    ["409 CONFLICT", jsonResponse(errorBody("CONFLICT", HOSTILE), 409), "error", MESSAGES.nameConflict],
    ["409 STALE_VERSION", jsonResponse(errorBody("STALE_VERSION", HOSTILE), 409), "stale", null],
    ["409 other code", jsonResponse(errorBody("SOMETHING_ELSE", HOSTILE), 409), "error", rejectedMessage(409)],
    ["429", jsonResponse(errorBody("RATE_LIMITED", HOSTILE), 429), "error", MESSAGES.rateLimited],
    ["422", jsonResponse(errorBody("X", HOSTILE), 422), "error", rejectedMessage(422)],
  ];
  const seen = new Set<string>();
  for (const [label, response, status, message] of cases) {
    const h = await save(response);
    assert.equal(h.state.status, status, label);
    assert.equal(h.state.message, message, label);
    if (message) seen.add(message);
    assert.equal(h.state.draft.name, "Mine", `${label}: the draft is kept`);
    assert.equal(h.state.version, 3, `${label}: the token is unchanged`);
    assert.equal(h.requests.length, 1, `${label}: never retried automatically`);
  }
  assert.equal(seen.size, 8, "400, 401, 403, 404, 409 CONFLICT, 409 other, 429 and 422 all read differently");
  assert.match(MESSAGES.unauthenticated, /^You're not signed in\. Sign in again before saving\. Your edits are still here\.$/);
  assert.match(MESSAGES.forbidden, /^Your account doesn't have permission to save this item\. Your edits are still here\.$/);
});

test("hostile server bodies are never shown, announced or stored in any state", async () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429, 500]) {
    const h = await save(jsonResponse(errorBody("STALE_VERSION" as string, HOSTILE), status));
    const everything = JSON.stringify({ message: h.state.message, info: h.state.info, side: h.state.sideMessage }) + notice(h.state) + liveMessage(h.state);
    assert.equal(everything.includes("secret-token"), false, String(status));
    assert.equal(everything.includes("SELECT"), false, String(status));
    assert.equal(everything.includes("script"), false, String(status));
  }
  const plain = await save(textResponse(HOSTILE, 502));
  assert.equal(notice(plain.state).includes("secret-token"), false);
});

test("network failure, server failure and a malformed reply are each an unknown outcome with their own reason, and keep the exact snapshot and token", async () => {
  const cases: Array<[string, Response | Error, string]> = [
    ["network", new TypeError("fetch failed"), "network"],
    ["500", jsonResponse(errorBody("INTERNAL", HOSTILE), 500), "server"],
    ["503", textResponse(HOSTILE, 503), "server"],
    ["malformed 200", textResponse("{not json", 200), "malformed"],
    ["200 without a version", jsonResponse({ id: "g1" }, 200), "malformed"],
  ];
  const texts = new Set<string>();
  for (const [label, response, reason] of cases) {
    const h = await save(response);
    assert.equal(h.state.status, "unknown", label);
    assert.equal(h.state.unknown?.reason, reason, label);
    assert.equal(h.state.unknown?.version, 3, label);
    assert.equal(h.state.unknown?.snapshot.name, "Mine", label);
    const markup = notice(h.state);
    assert.match(markup, /data-notice="unknown-outcome"/);
    assert.match(markup, /couldn&#x27;t confirm whether your save was applied/);
    texts.add(markup.replace(/<[^>]*>/g, "|"));
    assert.equal(canSave(h.state), false, "no new save until the outcome is resolved");
  }
  assert.equal(texts.size, 3, "three reasons, three different texts");
});

test("a retry after an unknown outcome still sends the original snapshot and token, whatever the wording", async () => {
  const h = createHarness({ responses: [textResponse(HOSTILE, 500), jsonResponse(errorBody("STALE_VERSION"), 409)] });
  h.edit("name", "Original");
  await h.controller.save();
  h.edit("name", "Edited after");
  await h.controller.retrySame();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1].body, h.requests[0].body);
  assert.equal(h.requests[1].body?.expectedVersion, 3);
  assert.equal(h.requests[1].body?.name, "Original");
  assert.equal(h.state.status, "stale");
});

test("a 429 from the request layer carries its status, and a 409 without a known code is a rejection, not a conflict", async () => {
  const fetch429 = async () => jsonResponse(errorBody("RATE_LIMITED", HOSTILE), 429);
  assert.deepEqual(await patchGear(fetch429, "g1", 3, {}), { kind: "rejected", status: 429 });
  assert.deepEqual(await patchGear(async () => jsonResponse({}, 409), "g1", 3, {}), { kind: "rejected", status: 409 });
  assert.deepEqual(await patchGear(async () => jsonResponse({}, 400), "g1", 3, {}), { kind: "invalid" });
});

test("create mode keeps its own failure wording and is unaffected by the edit-mode messages", () => {
  const created = createEditorState(null, "create");
  const sending = editorReducer(created, { type: "saveStarted", generation: 1, snapshot: { ...created.draft } } as EditorAction);
  for (const outcome of [{ kind: "invalid" }, { kind: "rejected", status: 429 }, { kind: "failed" }]) {
    const after = editorReducer(sending, { type: "saveFinished", generation: 1, outcome } as EditorAction);
    assert.equal(after.message, MESSAGES.createFailed, outcome.kind);
  }
});

test("errors are role=alert only: no error text ever appears in the polite status text or in a role=status element", async () => {
  for (const status of [400, 401, 403, 404, 409, 429, 500]) {
    const h = await save(jsonResponse(errorBody("CONFLICT"), status));
    const markup = notice(h.state);
    assert.match(markup, /role="alert"/, String(status));
    assert.equal(markup.includes('role="status"'), false, String(status));
    assert.equal(liveMessage(h.state), "", `${status}: the persistent live region stays silent so errors are announced once`);
  }
});

test("informational results are announced once: by the persistent live region, not by a second role=status", () => {
  const info = { ...createEditorState(null, "create"), info: MESSAGES.loaded, status: "idle" as const };
  assert.equal(liveMessage(info), MESSAGES.loaded);
  const markup = notice(info);
  assert.match(markup, /data-notice="info"/);
  assert.equal(markup.includes('role="status"'), false);
  assert.equal(markup.includes("aria-live"), false);
});
