import assert from "node:assert/strict";
import test from "node:test";
import { BRAND_MAX_LENGTH, toBrandIdentity } from "@/lib/ingestion/brandResolution";
import { createBrandSchema } from "./adminBrand";

const SECRET = "SECRET-CLIENT-NAME-31";
const parse = (name: unknown, extra: Record<string, unknown> = {}) => createBrandSchema.safeParse({ name, ...extra });

test("valid names are accepted and trimmed; internal whitespace is allowed (it is collapsed when stored)", () => {
    for (const [input, expected] of [["Nike", "Nike"], ["  Expntl   Athletics ", "Expntl   Athletics"], ["x".repeat(BRAND_MAX_LENGTH), "x".repeat(BRAND_MAX_LENGTH)], ["Café", "Café"]]) {
        const result = parse(input);
        assert.equal(result.success, true, JSON.stringify(input));
        assert.equal(result.success && result.data.name, expected);
    }
});

test("names are limited to the importer's rules: 1-100 characters, no control characters, a storable key", () => {
    for (const bad of ["", "   ", "x".repeat(BRAND_MAX_LENGTH + 1), "a\u0000b", "a\u001Fb", "a\tb", "a\nb", "a\u007Fb", "a\u0085b", "ﷺ".repeat(6)]) {
        assert.equal(parse(bad).success, false, JSON.stringify(bad));
    }
    for (const notText of [undefined, null, 5, {}, [], true]) {
        assert.equal(parse(notText).success, false, JSON.stringify(notText));
    }
    assert.equal(createBrandSchema.safeParse({}).success, false);
    assert.equal(createBrandSchema.safeParse(null).success, false);
});

test("the old 120-character allowance is gone: 101-120 characters are now rejected", () => {
    for (const length of [101, 110, 120]) assert.equal(parse("n".repeat(length)).success, false, String(length));
});

test("the schema accepts exactly what the importer accepts (after trimming)", () => {
    const corpus = [
        "Nike", " Nike ", "NIKE", "", " ", "x".repeat(100), "x".repeat(101), "a\u0000b", "a b", "a  b", "a\tb", "Café", "ＮＩＫＥ",
        "​", "﻿", " ", "ﷺ".repeat(5), "ﷺ".repeat(6), "Straße", "İstanbul", "name other", "emoji \u{1F600}",
    ];

    for (const name of corpus) {
        assert.equal(parse(name).success, toBrandIdentity(name.trim()) !== null, JSON.stringify(name));
    }
});

test("validation messages are fixed text and never echo the submitted value", () => {
    for (const bad of [`${SECRET}\u0000`, SECRET.repeat(10), ""]) {
        const result = parse(bad);
        assert.equal(result.success, false);
        const messages = !result.success ? result.error.issues.map((issue) => issue.message).join("|") : "";
        assert.doesNotMatch(messages, new RegExp(SECRET));
        assert.match(messages, /Brand name must be 1-100 characters with no control characters\./);
    }
});

test("tier and style behave as before: optional, nullable, trimmed", () => {
    assert.deepEqual(parse("Nike", { tier: " premium ", style: null }).success && parse("Nike", { tier: " premium ", style: null }).data, { name: "Nike", tier: "premium", style: null });
    assert.equal(parse("Nike").success, true);
    assert.equal(parse("Nike", { tier: 5 }).success, false);
    assert.equal(parse("Nike", { style: {} }).success, false);
});

test("unknown fields are stripped, so a client cannot inject an id or a normalized key", () => {
    const result = parse("Nike", { id: "forced", normalizedName: "forced", createdAt: "2000-01-01" });

    assert.equal(result.success, true);
    assert.deepEqual(result.success && Object.keys(result.data).sort(), ["name"]);
});
