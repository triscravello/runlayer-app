import assert from "node:assert/strict";
import test from "node:test";
import { isSafeHttpUrl, MAX_EXTERNAL_URL_LENGTH, safeHttpUrl } from "./externalUrl";

const SAFE = [
    "https://example.com",
    "http://example.com",
    "https://example.com/path/to/product?id=1&ref=runlayer#top",
    "https://shop.example.com:8443/p",
    "https://xn--bcher-kva.example/p",
    "http://127.0.0.1:3000/x",
    "HTTPS://example.com",
    "HTTP://example.com/Path?Q=1",
    "Https://Example.COM/x",
    "hTtP://example.com",
    "https://example.com/" + "a".repeat(MAX_EXTERNAL_URL_LENGTH - "https://example.com/".length),
];

const UNSAFE: Array<[string, unknown]> = [
    ["javascript:", "javascript:alert(1)"],
    ["javascript: with leading space and mixed case", "  JaVaScRiPt:alert(1)"],
    ["javascript: with an embedded tab", "java\tscript:alert(1)"],
    ["javascript: with an embedded newline", "java\nscript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["file:", "file:///etc/passwd"],
    ["ftp:", "ftp://example.com/x"],
    ["intent:", "intent://scan#Intent;scheme=zxing;end"],
    ["mailto:", "mailto:a@example.com"],
    ["tel:", "tel:+15555550100"],
    ["blob:", "blob:https://example.com/uuid"],
    ["about:", "about:blank"],
    ["protocol-relative", "//evil.example/x"],
    ["relative path", "/x"],
    ["bare host", "example.com"],
    ["uppercase scheme with credentials", "HTTPS://user:pass@example.com/x"],
    ["uppercase scheme with an embedded user", "HTTP://user@example.com"],
    ["uppercase scheme with a space", "HTTPS://exa mple.com"],
    ["uppercase scheme with no host", "HTTPS://"],
    ["uppercase non-http scheme", "JAVASCRIPT:alert(1)"],
    ["uppercase ftp", "FTP://example.com/x"],
    ["uppercase data", "DATA:text/html,x"],
    ["near-miss scheme prefix", "httpss://example.com"],
    ["scheme without slashes", "https:example.com"],
    ["single slash", "https:/example.com"],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["leading space", " https://example.com"],
    ["trailing space", "https://example.com "],
    ["embedded space", "https://exa mple.com"],
    ["embedded newline in an http URL", "https://exa\nmple.com"],
    ["NUL byte", "https://example.com/\u0000"],
    ["DEL / C1 control", "https://example.com/\u007f"],
    ["scheme with no host", "https://"],
    ["scheme with only a path", "https:///x"],
    ["embedded user", "https://user@example.com"],
    ["embedded credentials", "https://user:pass@example.com/x"],
    ["look-alike credentials", "https://trusted.example@evil.example/x"],
    ["empty credentials", "https://@example.com/x"],
    ["over the length limit", "https://example.com/" + "a".repeat(MAX_EXTERNAL_URL_LENGTH)],
    ["null", null],
    ["undefined", undefined],
    ["number", 5],
    ["object", { href: "https://example.com" }],
    ["array", ["https://example.com"]],
];

test("safe http(s) URLs are accepted", () => {
    for (const value of SAFE) assert.equal(isSafeHttpUrl(value), true, value.slice(0, 80));
});

test("unsafe, malformed, credential-bearing and non-string values are rejected", () => {
    for (const [label, value] of UNSAFE) assert.equal(isSafeHttpUrl(value), false, label);
});

test("uppercase and mixed-case http(s) schemes are accepted and returned unchanged", () => {
    for (const value of ["HTTPS://example.com", "HTTP://example.com/Path?Q=1", "Https://Example.COM/x"]) assert.equal(safeHttpUrl(value), value);
});

test("the length limit is exactly 2048 characters", () => {
    assert.equal(SAFE[SAFE.length - 1].length, MAX_EXTERNAL_URL_LENGTH);
    assert.equal(isSafeHttpUrl(SAFE[SAFE.length - 1]), true);
    assert.equal(isSafeHttpUrl(SAFE[SAFE.length - 1] + "a"), false);
});

test("safeHttpUrl returns the value unchanged or null", () => {
    assert.equal(safeHttpUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
    assert.equal(safeHttpUrl("javascript:alert(1)"), null);
    assert.equal(safeHttpUrl(undefined), null);
});
