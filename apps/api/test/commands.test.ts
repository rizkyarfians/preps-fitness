import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, type JsonValue } from '../src/commands.js';
test('canonical JSON sorts nested keys, preserves arrays and distinguishes payloads', () => {
 assert.equal(canonicalJson({ b: { d: 1, c: 2 }, a: [2, 1] }), canonicalJson({ a: [2, 1], b: { c: 2, d: 1 } }));
 assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
 assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
});
test('non-JSON payloads cannot silently collapse to the same hash', () => {
 for (const v of [NaN, Infinity, undefined, { a: undefined }, new Date(), [undefined], new Array(2)]) assert.throws(() => canonicalJson(v as JsonValue));
});
