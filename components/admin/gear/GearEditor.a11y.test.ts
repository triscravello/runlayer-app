import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GearEditor } from "./GearEditor";
import { GearConflictNotice, GearEditorNotices, GearUnknownOutcomeNotice } from "./GearEditorNotices";
import { createEditorState, editorReducer, UNKNOWN_REASON_TEXT, type EditorAction, type EditorState } from "./gearEditorState";
import { gearItem } from "./gearEditorTestKit";

// Static-markup accessibility structure tests (no DOM library). They check the programmatic relationships the first render commits: labels,
// ids, descriptions, groups and focus anchors. They do not prove how a browser or screen reader behaves.

const noop = () => undefined;
const handlers = { onKeepEditing: noop, onLoadLatest: noop, onRetry: noop, onCheckLatest: noop };
const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);
const editor = (props: object = {}) => createElement(GearEditor, { item: gearItem(), mode: "edit", brands: [{ id: "b1", name: "Acme" }], ...props });

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const tags = (markup: string, name: string) => markup.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
const controls = (markup: string) => [...tags(markup, "input"), ...tags(markup, "select"), ...tags(markup, "textarea")];
const labels = (markup: string) => [...markup.matchAll(/<label\b([^>]*)>([^<]*)<\/label>/g)].map((m) => ({ htmlFor: attr(m[0], "for"), text: m[2] }));
const allIds = (markup: string) => [...markup.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);

const EXPECTED_LABELS = ["Gear Name", "Brand", "Category", "Subcategory", "Price range", "Gender", "Description", "Primary image URL", "Affiliate URL", "Tags", "Body type fit", "Hot weather", "Cold weather", "Rain", "Wind"];

test("every visible label names exactly one control, and every control has an accessible name", () => {
  const markup = renderToStaticMarkup(editor());
  const byId = new Map(controls(markup).map((tag) => [attr(tag, "id"), tag]));
  const found = labels(markup);
  assert.deepEqual(found.map((l) => l.text), EXPECTED_LABELS, "the control inventory is exactly the audited one");
  for (const label of found) {
    assert.ok(label.htmlFor, `${label.text} has htmlFor`);
    assert.ok(byId.has(label.htmlFor), `${label.text} points at an existing control`);
  }
  const named = new Set(found.map((l) => l.htmlFor));
  for (const tag of controls(markup)) {
    assert.ok(named.has(attr(tag, "id")) || attr(tag, "aria-label"), `unnamed control: ${tag.slice(0, 80)}`);
  }
  assert.equal(controls(markup).length, EXPECTED_LABELS.length + 1, "15 labelled controls plus the new-brand input");
});

test("the new-brand input and the disabled Description textarea have accessible names", () => {
  const markup = renderToStaticMarkup(editor());
  const brand = controls(markup).find((tag) => attr(tag, "aria-label") === "New brand name");
  assert.ok(brand && attr(brand, "id"), "the new-brand input is named without relying on its placeholder");
  const description = tags(markup, "textarea")[0] ?? "";
  assert.ok(/\sdisabled=""/.test(description));
  const descriptionLabel = labels(markup).find((l) => l.text === "Description");
  assert.equal(descriptionLabel?.htmlFor, attr(description, "id"), "the disabled textarea is still labelled");
});

test("ids are unique within one editor and across several editors rendered together, in edit and create mode", () => {
  const single = allIds(renderToStaticMarkup(editor()));
  assert.equal(new Set(single).size, single.length, "unique within one editor");
  const many = renderToStaticMarkup(createElement(Fragment, null, editor(), editor(), editor({ item: null, mode: "create" })));
  const ids = allIds(many);
  assert.equal(new Set(ids).size, ids.length, "unique across editors");
  const labelTargets = labels(many).map((l) => l.htmlFor);
  assert.equal(new Set(labelTargets).size, labelTargets.length, "no two labels (in different editors) point at the same control");
});

test("help text and hints are linked with aria-describedby, and every reference resolves to an element", () => {
  const markup = renderToStaticMarkup(editor());
  const ids = new Set(allIds(markup));
  let linked = 0;
  for (const tag of controls(markup)) {
    for (const id of (attr(tag, "aria-describedby") ?? "").split(/\s+/).filter(Boolean)) {
      assert.ok(ids.has(id), `aria-describedby target ${id} exists`);
      linked += 1;
    }
  }
  assert.ok(linked >= 8, `hints and help text are referenced (${linked})`);
});

test("the four weather inputs sit in a group labelled by the section heading", () => {
  const markup = renderToStaticMarkup(editor());
  const group = tags(markup, "div").find((tag) => attr(tag, "role") === "group");
  assert.ok(group, "a role=group exists");
  const headingId = attr(group, "aria-labelledby");
  assert.ok(headingId);
  assert.match(markup, new RegExp(`<h3 id="${headingId?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>Weather Conditions</h3>`));
  const groupHtml = markup.slice(markup.indexOf(group) + group.length);
  const inside = groupHtml.slice(0, groupHtml.indexOf("</div></div></div>") + 1);
  for (const label of ["Hot weather", "Cold weather", "Rain", "Wind"]) assert.ok(inside.includes(`>${label}</label>`), label);
});

test("an invalid affiliate URL is flagged on the control and described by its error text", () => {
  const markup = renderToStaticMarkup(editor({ item: gearItem({ affiliateUrl: "not a url" }) }));
  const affiliate = controls(markup).find((tag) => attr(tag, "value") === "not a url");
  assert.ok(affiliate && attr(affiliate, "aria-invalid") === "true");
  const describedBy = (attr(affiliate, "aria-describedby") ?? "").split(/\s+/);
  const errorId = describedBy[describedBy.length - 1];
  assert.match(markup, new RegExp(`id="${errorId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>\\s*Enter a valid URL`));
});

test("focus anchors: Save and the first field are always present, and each recovery control appears exactly once", () => {
  const clean = renderToStaticMarkup(editor());
  assert.equal(clean.match(/data-focus="save"/g)?.length, 1);
  assert.equal(clean.match(/data-focus="first-field"/g)?.length, 1);
  const staleState = run(createEditorState(gearItem(), "edit"), { type: "edit", key: "name", value: "x" }, { type: "saveStarted", generation: 1, snapshot: createEditorState(gearItem(), "edit").draft }, { type: "saveFinished", generation: 1, outcome: { kind: "stale" } });
  const open = renderToStaticMarkup(createElement(GearEditorNotices, { state: staleState, ...handlers }));
  assert.equal(open.match(/data-focus="conflict-primary"/g)?.length, 1);
  assert.equal(open.match(/data-focus="load-latest"/g)?.length, 1);
  const acknowledged = renderToStaticMarkup(createElement(GearEditorNotices, { state: run(staleState, { type: "keepEditing" }), ...handlers }));
  assert.equal(acknowledged.includes('data-focus="conflict-primary"'), false, "Keep editing is gone once chosen");
  assert.equal(acknowledged.match(/data-focus="load-latest"/g)?.length, 1);
  const unknown = renderToStaticMarkup(createElement(GearUnknownOutcomeNotice, { busy: false, onRetry: noop, onCheckLatest: noop }));
  assert.equal(unknown.match(/data-focus="retry"/g)?.length, 1);
  assert.equal(unknown.match(/data-focus="check-latest"/g)?.length, 1);
});

test("notice description ids are unique per rendered notice and resolve", () => {
  const both = renderToStaticMarkup(createElement(Fragment, null,
    createElement(GearConflictNotice, { acknowledged: false, busy: false, onKeepEditing: noop, onLoadLatest: noop }),
    createElement(GearConflictNotice, { acknowledged: false, busy: false, onKeepEditing: noop, onLoadLatest: noop }),
    createElement(GearUnknownOutcomeNotice, { busy: false, onRetry: noop, onCheckLatest: noop })));
  const ids = allIds(both);
  assert.equal(new Set(ids).size, ids.length);
  for (const ref of [...both.matchAll(/aria-describedby="([^"]*)"/g)].map((m) => m[1])) assert.ok(ids.includes(ref), `${ref} resolves`);
  assert.equal(both.includes('id="gear-conflict-detail"') || both.includes('id="gear-unknown-detail"'), false, "no hardcoded ids remain");
});

test("the unknown-outcome notice says why, without claiming the save did or did not happen", () => {
  for (const reason of ["network", "server", "malformed"] as const) {
    const markup = renderToStaticMarkup(createElement(GearUnknownOutcomeNotice, { busy: false, reason, onRetry: noop, onCheckLatest: noop }));
    assert.ok(markup.includes(UNKNOWN_REASON_TEXT[reason].replaceAll("'", "&#x27;")), reason);
    assert.match(markup, /couldn&#x27;t confirm whether your save was applied/);
    assert.equal(/was not saved|nothing was saved|definitely/i.test(markup), false, "no claim about the outcome");
  }
});
