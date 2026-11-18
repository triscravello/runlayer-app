import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyOverrides, buildGearPayload, decideAddGear, decideSelect, DISCARD_ON_SWITCH_MESSAGE, fieldsEqual, isUsableVersion, mayLeaveEditor, mergeSavedGearItem, parseGearItem, resolveSelectedItem, shouldAdoptLatest, toFields, validateFields, type GearEditorItem } from "./gearEditorModel";
import { gearItem } from "./gearEditorTestKit";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !(value instanceof Date)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

test("isUsableVersion accepts exactly the integers the server accepts (0..2147483647) and nothing else", () => {
  for (const good of [0, 1, 3, 2_147_483_647]) assert.equal(isUsableVersion(good), true, String(good));
  for (const bad of ["1", "", null, undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, 2 ** 53, true, [], {}, BigInt(1)]) assert.equal(isUsableVersion(bad), false, String(typeof bad));
});

test("validateFields keeps the existing messages and their order", () => {
  const fields = toFields(gearItem());
  assert.equal(validateFields(fields), null);
  assert.equal(validateFields({ ...fields, imageUrl: "ftp://x" }), "Image URL must be a valid http or https URL.");
  assert.equal(validateFields({ ...fields, affiliateUrl: "javascript:x" }), "Affiliate URL must be blank or a valid http or https URL.");
  assert.equal(validateFields({ ...fields, name: "  " }), "Name, brand ID, category, and price range are required.");
  assert.equal(validateFields({ ...fields, brandId: "" }), "Name, brand ID, category, and price range are required.");
  assert.equal(validateFields({ ...fields, genderTarget: "ROBOT" }), "Gender must be Men, Women, or Unisex");
  assert.equal(validateFields({ ...fields, imageUrl: "ftp://x", affiliateUrl: "javascript:x", name: "" }), "Image URL must be a valid http or https URL.", "the image check still comes first");
});

test("buildGearPayload is the editor's existing request body: same fields and semantics, never a version or token", () => {
  const fields = { ...toFields(gearItem()), tags: "Light, trail ,", subcategory: "  ", weatherHot: "", weatherCold: "2", genderTarget: "" };
  const payload = buildGearPayload(fields);
  assert.deepEqual(payload, {
    name: "Trail Tee", brandId: "b1", category: "TOP", priceRange: "MID", genderTarget: null, subcategory: null, tags: ["Light", "trail"], bodyTypeFit: ["slim"],
    imageUrl: null, affiliateUrl: "https://shop.example.com/a",
    weatherSuitability: { hot: null, cold: 1, rain: null, wind: null },
  });
  assert.equal("hot" in payload.weatherSuitability && payload.weatherSuitability.hot, null, "a blank hot score is still sent as null (existing behavior, unchanged)");
  for (const forbidden of ["expectedVersion", "version", "id"]) assert.equal(forbidden in payload, false, forbidden);
});

test("fieldsEqual compares every field", () => {
  const a = toFields(gearItem());
  assert.equal(fieldsEqual(a, { ...a }), true);
  for (const key of Object.keys(a) as Array<keyof typeof a>) assert.equal(fieldsEqual(a, { ...a, [key]: `${a[key]}x` }), false, key);
});

test("mergeSavedGearItem merges the scalar response into the entry with the SAME id and preserves brand and variants", () => {
  const entry = deepFreeze({ ...gearItem(), variants: [{ id: "v1", label: "Default" }], brand: { name: "Acme" } });
  const merged = mergeSavedGearItem(entry, { id: "g1", name: "Renamed", version: 4, updatedAt: "2026-03-01T00:00:00.000Z", tags: ["a"], weatherHot: null, notAColumn: "x" });
  assert.equal(merged.name, "Renamed");
  assert.equal(merged.version, 4);
  assert.equal(merged.updatedAt, "2026-03-01T00:00:00.000Z");
  assert.deepEqual(merged.tags, ["a"]);
  assert.equal(merged.weatherHot, null);
  assert.deepEqual(merged.brand, { name: "Acme" }, "the brand is preserved (the response has none)");
  assert.deepEqual(Object.entries(merged).find(([key]) => key === "variants")?.[1], [{ id: "v1", label: "Default" }], "variants are preserved");
  assert.equal("notAColumn" in merged, false, "unknown response keys are ignored");
  assert.equal(entry.name, "Trail Tee", "the input is not modified (it is frozen)");
});

test("mergeSavedGearItem matches by id only, ignores mistyped columns, and refreshes the brand only when the brand id changed", () => {
  const entry = gearItem();
  assert.equal(mergeSavedGearItem(entry, { id: "OTHER", name: "Hijack", version: 9 }), entry, "a different id returns the entry unchanged (same reference)");
  const guarded = mergeSavedGearItem(entry, { id: "g1", name: 5, tags: [1], version: "9", category: "SHOES", weatherHot: Number.NaN, updatedAt: 7 });
  assert.deepEqual([guarded.name, guarded.tags, guarded.version, guarded.category, guarded.weatherHot, guarded.updatedAt], [entry.name, entry.tags, 3, "TOP", 0.4, entry.updatedAt], "every mistyped column is ignored");
  assert.deepEqual(mergeSavedGearItem(entry, { id: "g1", brandId: "b2" }, [{ id: "b2", name: "Zed" }]).brand, { name: "Zed" });
  assert.equal(mergeSavedGearItem(entry, { id: "g1", brandId: "b9" }, [{ id: "b2", name: "Zed" }]).brand, null, "an unknown new brand clears the (now wrong) old one");
  assert.deepEqual(mergeSavedGearItem(entry, { id: "g1", brandId: "b1", name: "Same brand" }, [{ id: "b1", name: "Different" }]).brand, { name: "Acme" }, "brand untouched while the brand id is unchanged");
});

test("applyOverrides uses a local copy only while it is NEWER than the server item", () => {
  const server = [gearItem({ id: "a", version: 3 }), gearItem({ id: "b", version: 3 }), gearItem({ id: "c", version: 3 }), gearItem({ id: "d", version: 3 })];
  const overrides = new Map<string, GearEditorItem>([
    ["a", gearItem({ id: "a", version: 4, name: "newer" })],
    ["b", gearItem({ id: "b", version: 3, name: "same version" })],
    ["c", gearItem({ id: "c", version: 2, name: "older" })],
    ["d", gearItem({ id: "d", version: null, name: "unusable" })],
  ]);
  const result = applyOverrides(server, overrides);
  assert.deepEqual(result.map((entry) => entry.name), ["newer", "Trail Tee", "Trail Tee", "Trail Tee"], "only the strictly newer override wins; a refresh can never be masked");
  assert.equal(result[1], server[1], "entries that keep the server copy keep their identity");
  assert.equal(applyOverrides(server, new Map())[0], server[0]);
});

test("parseGearItem validates a server item and rejects anything unusable, including a missing or malformed version", () => {
  const good = parseGearItem({ ...gearItem(), variants: [{ id: "v" }], brand: { id: "b1", name: "Acme", normalizedName: "acme" } });
  assert.ok(good);
  assert.equal(good.version, 3);
  assert.deepEqual(good.brand, { name: "Acme" });
  assert.equal("variants" in good, false, "relations other than the brand name are not part of the editor's item");
  assert.deepEqual(parseGearItem({ ...gearItem(), brand: null })?.brand, null);
  for (const bad of [null, "x", [], {}, { ...gearItem(), id: "" }, { ...gearItem(), id: 5 }, { ...gearItem(), name: null }, { ...gearItem(), category: "SHOES" }, { ...gearItem(), priceRange: "FREE" }, { ...gearItem(), tags: "a" }, { ...gearItem(), bodyTypeFit: [1] }, { ...gearItem(), weatherHot: "0.4" }, { ...gearItem(), imageUrl: 3 }, { ...gearItem(), updatedAt: 5 }]) {
    assert.equal(parseGearItem(bad), null, JSON.stringify(bad)?.slice(0, 60));
  }
  for (const version of [undefined, null, "3", -1, 1.5, 2_147_483_648, Number.NaN]) assert.equal(parseGearItem({ ...gearItem(), version }), null, `version ${String(version)}`);
});

test("switching away from the editor: a clean editor leaves silently, a dirty one needs an explicit yes, and a no cancels the switch", () => {
  const asked: string[] = [];
  assert.equal(mayLeaveEditor(false, (message) => { asked.push(message); return false; }), true);
  assert.equal(asked.length, 0, "a clean editor is never asked");
  assert.equal(mayLeaveEditor(true, (message) => { asked.push(message); return true; }), true);
  assert.equal(mayLeaveEditor(true, (message) => { asked.push(message); return false; }), false, "cancelling keeps the selection and the draft");
  assert.deepEqual(asked, [DISCARD_ON_SWITCH_MESSAGE, DISCARD_ON_SWITCH_MESSAGE]);
});

test("a late, older or equal saved response can never overwrite a newer catalog entry", () => {
  const newer = gearItem({ name: "Newest", version: 5 });
  assert.equal(mergeSavedGearItem(newer, { id: "g1", name: "Late old save", version: 4 }), newer, "older version: ignored, same reference");
  assert.equal(mergeSavedGearItem(newer, { id: "g1", name: "Duplicate", version: 5 }), newer, "equal version: ignored");
  assert.equal(mergeSavedGearItem(newer, { id: "g1", name: "Newer", version: 6 }).name, "Newer");
  assert.equal(mergeSavedGearItem(gearItem({ version: null }), { id: "g1", name: "Legacy entry", version: 1 }).name, "Legacy entry", "an entry without a usable version still accepts a saved response");
});

test("a late, older server copy can not replace a newer catalog entry; a newer or equal one can", () => {
  const current = gearItem({ version: 5 });
  assert.equal(shouldAdoptLatest(current, gearItem({ version: 4 })), false);
  assert.equal(shouldAdoptLatest(current, gearItem({ version: 5 })), true);
  assert.equal(shouldAdoptLatest(current, gearItem({ version: 6 })), true);
  assert.equal(shouldAdoptLatest(undefined, gearItem({ version: 1 })), true);
  assert.equal(shouldAdoptLatest(gearItem({ version: null }), gearItem({ version: 1 })), true);
});

test("catalog switching decisions: re-selecting the open item is ignored, a dirty editor needs an explicit yes, and the same rule covers Add gear and create mode", () => {
  const asked: string[] = [];
  const yes = (message: string) => { asked.push(message); return true; };
  const no = (message: string) => { asked.push(message); return false; };
  const edit = { isCreating: false, selectedId: "g1" };

  assert.equal(decideSelect("g1", { ...edit, dirty: true, confirm: no }), "ignore", "the open item is not a switch, so nothing is asked");
  assert.equal(asked.length, 0);
  assert.equal(decideSelect("g2", { ...edit, dirty: false, confirm: no }), "switch", "a clean editor switches silently");
  assert.equal(asked.length, 0);
  assert.equal(decideSelect("g2", { ...edit, dirty: true, confirm: no }), "blocked", "declining keeps the selection and the draft");
  assert.equal(decideSelect("g2", { ...edit, dirty: true, confirm: yes }), "switch", "accepting permits the switch");
  assert.deepEqual(asked, [DISCARD_ON_SWITCH_MESSAGE, DISCARD_ON_SWITCH_MESSAGE]);

  // Create mode: the "open item" is the new-item form, so selecting any existing item is a switch (and an item id equal to the stale selection is not "open").
  assert.equal(decideSelect("g1", { isCreating: true, selectedId: "g1", dirty: true, confirm: no }), "blocked");
  assert.equal(decideSelect("g1", { isCreating: true, selectedId: "g1", dirty: false, confirm: no }), "switch");
  assert.equal(decideAddGear({ dirty: true, confirm: no }), "blocked");
  assert.equal(decideAddGear({ dirty: true, confirm: yes }), "switch");
  assert.equal(decideAddGear({ dirty: false, confirm: no }), "switch");
});

test("the catalog really calls these decisions: both entry points go through them (a structural wiring check, since there is no DOM test library)", () => {
  const source = readFileSync(fileURLToPath(new URL("./AdminGearCatalog.tsx", import.meta.url)), "utf8");
  assert.match(source, /decideSelect\(itemId,[\s\S]*?if \(decision !== "switch"\) return;[\s\S]*?setSelectedItemId\(itemId\)/, "item selection honors the decision: anything but \"switch\" returns BEFORE the selection changes");
  assert.match(source, /decideAddGear\(\{[^}]*\}\) !== "switch"\) return;[\s\S]*?setIsCreating\(true\)/, "Add gear honors the decision before entering create mode");
  assert.match(source, /onDirtyChange=\{handleDirtyChange\}/, "the editor's dirty state reaches the catalog");
  assert.match(source, /shouldAdoptLatest\(/, "a reloaded copy is adopted only when it is not older");
  assert.equal((source.match(/setSelectedItemId\(itemId\)/g) ?? []).length, 1, "exactly one place selects an item by id");
  assert.ok(source.indexOf("decideSelect(itemId,") < source.indexOf("setSelectedItemId(itemId)"), "and it comes after the decision");
});

test("the selection only falls back when the selected id is gone from the catalog: filters, overrides and refreshed copies never move it", () => {
  const catalog = [gearItem({ id: "a" }), gearItem({ id: "b" }), gearItem({ id: "c" })];
  const resolve = (selectedItemId: string | null, filtered = catalog, items = catalog, isCreating = false) => resolveSelectedItem({ isCreating, selectedItemId, catalogItems: items, filteredItems: filtered })?.id ?? null;
  assert.equal(resolve("b"), "b");
  assert.equal(resolve("b", [catalog[0]]), "b", "a filter that hides the selected item does not change the selection (the conflict's editor stays mounted)");
  assert.equal(resolve("b", []), "b");
  const refreshed = [catalog[0], gearItem({ id: "b", version: 9 }), catalog[2]];
  assert.equal(resolve("b", refreshed, refreshed), "b", "a refresh that brings a newer copy keeps the same selection (same id, so the same editor)");
  assert.equal(resolve("b", [catalog[2]], [catalog[0], catalog[2]]), "c", "only when the id is absent from the whole catalog does it fall back (to the first visible item)");
  assert.equal(resolve(null, catalog, catalog), "a");
  assert.equal(resolve("b", catalog, catalog, true), null, "create mode shows no existing item");
});
