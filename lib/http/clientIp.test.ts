import assert from "node:assert/strict";
import test from "node:test";
import {
    ClientIpConfigError,
    MAX_FORWARDED_HEADER_LENGTH,
    UNKNOWN_CLIENT_IP,
    parseClientIpStrategy,
    resolveClientIp,
    resolveClientIpFromEnv,
    type ClientIpStrategy,
} from "./clientIp";

const none: ClientIpStrategy = { kind: "none" };
const hops = (count: number): ClientIpStrategy => ({ kind: "xff-hops", hops: count });
const header = (name: string): ClientIpStrategy => ({ kind: "header", name });

function headersOf(values: Record<string, string>) {
    return new Headers(values);
}

// --- parseClientIpStrategy -----------------------------------------------

test("the strategy defaults to none outside production", () => {
    for (const nodeEnv of ["development", "test", undefined]) {
        for (const raw of [undefined, "", "   "]) {
            assert.deepEqual(parseClientIpStrategy(raw, nodeEnv), { ok: true, strategy: { kind: "none" } });
        }
    }
});

test("production requires an explicit strategy", () => {
    for (const raw of [undefined, "", "   "]) {
        const result = parseClientIpStrategy(raw, "production");
        assert.equal(result.ok, false);
        assert.match(result.ok ? "" : result.error, /CLIENT_IP_STRATEGY/);
    }

    assert.deepEqual(parseClientIpStrategy("none", "production"), { ok: true, strategy: { kind: "none" } });
});

test("valid strategies are parsed and normalized", () => {
    assert.deepEqual(parseClientIpStrategy(" NONE ", "production"), { ok: true, strategy: { kind: "none" } });
    assert.deepEqual(parseClientIpStrategy("header:CF-Connecting-IP", "production"), { ok: true, strategy: { kind: "header", name: "cf-connecting-ip" } });
    assert.deepEqual(parseClientIpStrategy("header: x-real-ip ", "production"), { ok: true, strategy: { kind: "header", name: "x-real-ip" } });
    assert.deepEqual(parseClientIpStrategy("xff-hops:1", "production"), { ok: true, strategy: { kind: "xff-hops", hops: 1 } });
    assert.deepEqual(parseClientIpStrategy("xff-hops:10", "production"), { ok: true, strategy: { kind: "xff-hops", hops: 10 } });
});

test("invalid strategies are rejected in every environment", () => {
    const invalid = [
        "xff",
        "trust",
        "x-forwarded-for",
        "header:",
        "header:   ",
        "header:x_real_ip",
        "header:has space",
        "header:a:b",
        "header:-leading",
        "header:trailing-",
        `header:${"a".repeat(65)}`,
        "header:x-forwarded-for",
        "header:forwarded",
        "xff-hops:",
        "xff-hops:0",
        "xff-hops:11",
        "xff-hops:-1",
        "xff-hops:1.5",
        "xff-hops:abc",
        "xff-hops:100",
        "none:extra",
    ];

    for (const nodeEnv of ["production", "development", undefined]) {
        for (const raw of invalid) {
            assert.equal(parseClientIpStrategy(raw, nodeEnv).ok, false, `expected rejection of ${JSON.stringify(raw)} in ${String(nodeEnv)}`);
        }
    }
});

test("strategy errors never echo the configured value", () => {
    const secretLooking = "header:sk_live_do_not_echo";
    const result = parseClientIpStrategy(secretLooking, "production");

    assert.equal(result.ok, false);
    assert.ok(!(result.ok ? "" : result.error).includes("sk_live"));
});

// --- strategy: none -------------------------------------------------------

test("none returns the stable unknown identifier and never reads any header", () => {
    const throwingHeaders = {
        get: () => {
            throw new Error("headers must not be read with the none strategy");
        },
    };

    assert.equal(resolveClientIp(throwingHeaders, none), UNKNOWN_CLIENT_IP);
});

test("none ignores spoofed forwarding headers", () => {
    const spoofed = headersOf({
        "x-forwarded-for": "6.6.6.6",
        "x-real-ip": "7.7.7.7",
        "cf-connecting-ip": "8.8.8.8",
        forwarded: "for=9.9.9.9",
    });

    assert.equal(resolveClientIp(spoofed, none), UNKNOWN_CLIENT_IP);
    assert.equal(resolveClientIp(headersOf({}), none), UNKNOWN_CLIENT_IP);
});

// --- strategy: xff-hops ---------------------------------------------------

test("xff-hops:1 uses the rightmost entry, so attacker-prepended values are ignored", () => {
    const keys = new Set<string>();

    for (const spoof of ["6.6.6.6", "1.1.1.1", "2001:db8::bad", "not-an-ip", "", "1.2.3.4, 5.6.7.8, 9.9.9.9"]) {
        keys.add(resolveClientIp(headersOf({ "x-forwarded-for": `${spoof}, 203.0.113.5` }), hops(1)));
    }

    assert.deepEqual([...keys], ["203.0.113.5"], "rotating the client-controlled left side never changes the key");
});

test("xff-hops:n selects the n-th entry from the right", () => {
    const value = "198.51.100.7, 203.0.113.5, 10.0.0.1";

    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": value }), hops(1)), "10.0.0.1");
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": value }), hops(2)), "203.0.113.5");
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": value }), hops(3)), "198.51.100.7");
});

test("fewer entries than trusted hops is unknown rather than a guess", () => {
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": "203.0.113.5" }), hops(2)), UNKNOWN_CLIENT_IP);
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }), hops(3)), UNKNOWN_CLIENT_IP);
});

test("a missing x-forwarded-for header is unknown", () => {
    assert.equal(resolveClientIp(headersOf({}), hops(1)), UNKNOWN_CLIENT_IP);
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": "" }), hops(1)), UNKNOWN_CLIENT_IP);
});

test("an oversized or over-long x-forwarded-for is unknown even if the trusted entry is valid", () => {
    const padding = "1.1.1.1, ".repeat(Math.ceil(MAX_FORWARDED_HEADER_LENGTH / 9) + 1);
    assert.ok(padding.length > MAX_FORWARDED_HEADER_LENGTH);
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": `${padding}203.0.113.5` }), hops(1)), UNKNOWN_CLIENT_IP);

    const manyEntries = Array.from({ length: 33 }, () => "1.1.1.1").join(",");
    assert.ok(manyEntries.length < MAX_FORWARDED_HEADER_LENGTH);
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": manyEntries }), hops(1)), UNKNOWN_CLIENT_IP);
});

test("garbage on the untrusted left side is ignored, garbage in the trusted position is unknown", () => {
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": "garbage;;;, <script>, 203.0.113.5" }), hops(1)), "203.0.113.5");
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": "203.0.113.5, garbage" }), hops(1)), UNKNOWN_CLIENT_IP);
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": "203.0.113.5," }), hops(1)), UNKNOWN_CLIENT_IP, "trailing empty entry");
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": "203.0.113.5, ,10.0.0.1" }), hops(2)), UNKNOWN_CLIENT_IP, "empty trusted entry");
});

test("spaces around entries are tolerated", () => {
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": "  1.1.1.1  ,   203.0.113.5   " }), hops(1)), "203.0.113.5");
});

// --- strategy: header -----------------------------------------------------

test("a trusted single-address header is used, and other forwarding headers are ignored", () => {
    const headers = headersOf({
        "x-real-ip": "203.0.113.9",
        "x-forwarded-for": "6.6.6.6",
        "cf-connecting-ip": "8.8.8.8",
    });

    assert.equal(resolveClientIp(headers, header("x-real-ip")), "203.0.113.9");
    assert.equal(resolveClientIp(headers, header("cf-connecting-ip")), "8.8.8.8");
});

test("header lookup is case-insensitive and tolerates surrounding whitespace", () => {
    assert.equal(resolveClientIp(headersOf({ "X-Real-IP": "  203.0.113.9 " }), header("x-real-ip")), "203.0.113.9");
});

test("a missing, empty, list-valued or over-long configured header is unknown", () => {
    assert.equal(resolveClientIp(headersOf({}), header("x-real-ip")), UNKNOWN_CLIENT_IP);
    assert.equal(resolveClientIp(headersOf({ "x-real-ip": "" }), header("x-real-ip")), UNKNOWN_CLIENT_IP);
    assert.equal(resolveClientIp(headersOf({ "x-real-ip": "1.1.1.1, 2.2.2.2" }), header("x-real-ip")), UNKNOWN_CLIENT_IP);
    assert.equal(resolveClientIp(headersOf({ "x-real-ip": `${"1".repeat(200)}` }), header("x-real-ip")), UNKNOWN_CLIENT_IP);
});

// --- address validation ---------------------------------------------------

test("valid IPv4 and IPv6 addresses are accepted", () => {
    assert.equal(resolveClientIp(headersOf({ "x-real-ip": "203.0.113.9" }), header("x-real-ip")), "203.0.113.9");
    assert.equal(resolveClientIp(headersOf({ "x-real-ip": "255.255.255.255" }), header("x-real-ip")), "255.255.255.255");
    assert.equal(resolveClientIp(headersOf({ "x-real-ip": "::1" }), header("x-real-ip")), "::1");
    assert.equal(resolveClientIp(headersOf({ "x-real-ip": "2001:db8::1" }), header("x-real-ip")), "2001:db8::1");
    assert.equal(resolveClientIp(headersOf({ "x-forwarded-for": "2001:db8::2" }), hops(1)), "2001:db8::2");
});

test("different notations of the same IPv6 address resolve to one key", () => {
    const forms = ["2001:db8::1", "2001:0db8:0000:0000:0000:0000:0000:0001", "2001:DB8:0:0:0:0:0:1", "2001:db8:0::1"];
    const keys = new Set(forms.map((form) => resolveClientIp(headersOf({ "x-real-ip": form }), header("x-real-ip"))));

    assert.deepEqual([...keys], ["2001:db8::1"]);
});

test("IPv4-mapped IPv6 addresses resolve to their IPv4 form", () => {
    assert.equal(resolveClientIp(headersOf({ "x-real-ip": "::ffff:203.0.113.9" }), header("x-real-ip")), "203.0.113.9");
    assert.equal(resolveClientIp(headersOf({ "x-real-ip": "::FFFF:cb00:7109" }), header("x-real-ip")), "203.0.113.9");
});

test("malformed addresses are unknown", () => {
    const malformed = [
        "999.1.1.1",
        "1.2.3",
        "1.2.3.4.5",
        "01.2.3.4",
        "1.2.3.4:8080",
        "[2001:db8::1]",
        "[2001:db8::1]:443",
        "fe80::1%eth0",
        "2001:db8::g",
        "2001:db8:::1",
        "abc",
        "localhost",
        "1.2.3.4/32",
        "0x7f.0.0.1",
        "1.2.3.4 5.6.7.8",
        "<script>alert(1)</script>",
        "'; DROP TABLE users;--",
        "1.2.3.4\u0000",
        "٣.٣.٣.٣",
    ];

    for (const value of malformed) {
        let resolved: string;
        try {
            resolved = resolveClientIp({ get: () => value }, header("x-real-ip"));
        } catch (error) {
            assert.fail(`resolve must not throw for ${JSON.stringify(value)}: ${String(error)}`);
        }
        assert.equal(resolved, UNKNOWN_CLIENT_IP, `expected unknown for ${JSON.stringify(value)}`);
    }
});

test("every output is either unknown or a bounded IP, whatever the input", () => {
    const inputs = ["", " ", ",", ",,,", "a".repeat(10_000), "1.2.3.4,".repeat(100), "::", "::ffff:0:0", "2001:db8::1".repeat(5), "\n", "1.2.3.4\r\nx: y"];

    for (const strategy of [none, hops(1), hops(2), header("x-real-ip")]) {
        for (const input of inputs) {
            const result = resolveClientIp({ get: () => input }, strategy);
            assert.ok(result === UNKNOWN_CLIENT_IP || result.length <= 45, `unbounded key for ${JSON.stringify(input.slice(0, 20))}`);
        }
    }
});

test("resolution is stable: the same input always gives the same key", () => {
    const headers = headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.5" });

    assert.equal(resolveClientIp(headers, hops(1)), resolveClientIp(headers, hops(1)));
    assert.equal(resolveClientIp(headersOf({}), hops(1)), resolveClientIp(headersOf({ "x-forwarded-for": "garbage" }), hops(1)));
});

// --- resolveClientIpFromEnv ----------------------------------------------

test("the environment wrapper defaults to none locally and ignores spoofed headers", () => {
    const spoofed = headersOf({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" });

    assert.equal(resolveClientIpFromEnv(spoofed, { NODE_ENV: "development" }), UNKNOWN_CLIENT_IP);
    assert.equal(resolveClientIpFromEnv(spoofed, {}), UNKNOWN_CLIENT_IP);
});

test("the environment wrapper applies the configured strategy", () => {
    const headers = headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.5" });

    assert.equal(resolveClientIpFromEnv(headers, { NODE_ENV: "production", CLIENT_IP_STRATEGY: "xff-hops:1" }), "203.0.113.5");
    assert.equal(resolveClientIpFromEnv(headersOf({ "x-real-ip": "203.0.113.9" }), { NODE_ENV: "production", CLIENT_IP_STRATEGY: "header:x-real-ip" }), "203.0.113.9");
});

test("the environment wrapper throws on an invalid strategy and on a missing strategy in production", () => {
    const headers = headersOf({ "x-forwarded-for": "6.6.6.6" });

    assert.throws(() => resolveClientIpFromEnv(headers, { NODE_ENV: "production" }), ClientIpConfigError);
    assert.throws(() => resolveClientIpFromEnv(headers, { NODE_ENV: "production", CLIENT_IP_STRATEGY: "trust-me" }), ClientIpConfigError);
    assert.throws(() => resolveClientIpFromEnv(headers, { NODE_ENV: "development", CLIENT_IP_STRATEGY: "xff-hops:0" }), ClientIpConfigError);
});
