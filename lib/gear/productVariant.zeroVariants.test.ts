import assert from "node:assert/strict";
import test from "node:test";
import { selectProductVariant } from "./productVariant";

// An item with no stored variants must stay valid now that a plain edit no longer synthesizes a Default variant.
test("selectProductVariant handles an item with zero variants", () => {
    assert.equal(selectProductVariant({ affiliateUrl: null, genderTarget: null, imageUrl: null, variants: [] }), null);
    assert.equal(selectProductVariant({ affiliateUrl: null, genderTarget: null, imageUrl: null, variants: undefined }), null);
    assert.deepEqual(selectProductVariant({ affiliateUrl: "https://example.com/buy", genderTarget: "men", imageUrl: null, variants: [] }), { label: "Default", gender: "men", affiliateUrl: "https://example.com/buy", imageUrl: undefined });
    assert.equal(selectProductVariant({ affiliateUrl: null, genderTarget: null, imageUrl: "https://example.com/i.png", variants: [] })?.imageUrl, "https://example.com/i.png");
});
