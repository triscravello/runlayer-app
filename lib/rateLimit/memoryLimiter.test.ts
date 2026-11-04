import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryLimiter } from "./memoryLimiter";

function createClock(start = 1_000_000) {
    let current = start;
    return {
        now: () => current,
        advance: (ms: number) => {
            current += ms;
        },
    };
}

test("allows requests within the limit and denies the ones beyond it", () => {
    const clock = createClock();
    const limiter = createMemoryLimiter({ limit: 3, windowMs: 10_000, now: clock.now });

    const results = [1, 2, 3, 4, 5].map(() => limiter.check("client"));

    assert.deepEqual(results.map((result) => result.success), [true, true, true, false, false]);
    assert.deepEqual(results.map((result) => result.remaining), [2, 1, 0, 0, 0]);
    assert.ok(results.every((result) => result.limit === 3));
    assert.ok(results.every((result) => result.reset === 1_010_000));
});

test("denied requests do not extend or inflate the window", () => {
    const clock = createClock();
    const limiter = createMemoryLimiter({ limit: 1, windowMs: 10_000, now: clock.now });

    limiter.check("client");
    for (let index = 0; index < 50; index += 1) {
        clock.advance(100);
        assert.equal(limiter.check("client").success, false);
    }

    clock.advance(10_000);
    assert.equal(limiter.check("client").success, true);
});

test("the window expires and the counter resets", () => {
    const clock = createClock();
    const limiter = createMemoryLimiter({ limit: 2, windowMs: 10_000, now: clock.now });

    assert.equal(limiter.check("client").success, true);
    assert.equal(limiter.check("client").success, true);
    assert.equal(limiter.check("client").success, false);

    clock.advance(9_999);
    assert.equal(limiter.check("client").success, false, "still inside the window one ms before reset");

    clock.advance(1);
    const afterReset = limiter.check("client");
    assert.equal(afterReset.success, true, "a new window starts exactly at reset");
    assert.equal(afterReset.remaining, 1);
    assert.equal(afterReset.reset, 1_020_000);
});

test("different keys have independent counters", () => {
    const clock = createClock();
    const limiter = createMemoryLimiter({ limit: 1, windowMs: 10_000, now: clock.now });

    assert.equal(limiter.check("a").success, true);
    assert.equal(limiter.check("a").success, false);
    assert.equal(limiter.check("b").success, true);
    assert.equal(limiter.check("b").success, false);
    assert.equal(limiter.check("c").success, true);
});

test("expired entries are purged before anything is evicted", () => {
    const clock = createClock();
    let evictions = 0;
    const limiter = createMemoryLimiter({ limit: 5, windowMs: 1_000, maxKeys: 3, now: clock.now, onEvict: () => { evictions += 1; } });

    limiter.check("a");
    limiter.check("b");
    clock.advance(1_000);

    limiter.check("c");
    limiter.check("d");
    limiter.check("e");

    assert.equal(evictions, 0);
    assert.equal(limiter.size(), 3);
});

test("a full table evicts the oldest entry, reports it, and never exceeds maxKeys", () => {
    const clock = createClock();
    let evictions = 0;
    const limiter = createMemoryLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3, now: clock.now, onEvict: () => { evictions += 1; } });

    for (const key of ["a", "b", "c"]) {
        assert.equal(limiter.check(key).success, true);
        clock.advance(1);
    }
    assert.equal(limiter.size(), 3);

    assert.equal(limiter.check("d").success, true);
    assert.equal(evictions, 1);
    assert.equal(limiter.size(), 3);

    // "a" was the oldest, so it was evicted and starts over; "b" and "c" are still counted.
    assert.equal(limiter.check("b").success, false);
    assert.equal(limiter.check("c").success, false);
    assert.equal(limiter.check("a").success, true);
});

test("memory stays bounded under a flood of unique keys", () => {
    const clock = createClock();
    let evictions = 0;
    const maxKeys = 100;
    const limiter = createMemoryLimiter({ limit: 5, windowMs: 60_000, maxKeys, now: clock.now, onEvict: () => { evictions += 1; } });

    let largest = 0;
    for (let index = 0; index < 20_000; index += 1) {
        limiter.check(`attacker-${index}`);
        largest = Math.max(largest, limiter.size());
    }

    assert.equal(largest, maxKeys);
    assert.equal(evictions, 20_000 - maxKeys);
});

test("very long identifiers are bounded and distinct long identifiers do not collide", () => {
    const clock = createClock();
    const limiter = createMemoryLimiter({ limit: 1, windowMs: 60_000, now: clock.now });

    const prefix = "x".repeat(5_000);
    const first = `${prefix}-one`;
    const second = `${prefix}-two`;

    assert.equal(limiter.check(first).success, true);
    assert.equal(limiter.check(first).success, false, "the same long identifier is the same key");
    assert.equal(limiter.check(second).success, true, "a different long identifier is a different key");
});

test("invalid options are rejected", () => {
    assert.throws(() => createMemoryLimiter({ limit: 0, windowMs: 1_000 }), /limit/);
    assert.throws(() => createMemoryLimiter({ limit: 1.5, windowMs: 1_000 }), /limit/);
    assert.throws(() => createMemoryLimiter({ limit: 1, windowMs: 0 }), /windowMs/);
    assert.throws(() => createMemoryLimiter({ limit: 1, windowMs: 1_000, maxKeys: 0 }), /maxKeys/);
});
