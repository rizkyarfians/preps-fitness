import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBenefit, type BenefitFacts } from '../src/benefits.js';
import type { Principal } from '../src/access.js';
const principal: Principal = { user: { id: 'user-a', name: 'A', email: 'a@example.test' }, gymId: 'gym-a', enabled: true, grants: [{ gymId: 'gym-a', branchId: 'branch-a', role: 'member' }] };
const start = new Date('2026-10-01T00:00:00Z'); const end = new Date('2026-11-01T00:00:00Z');
const facts: BenefitFacts = { gymId: 'gym-a', userId: 'user-a', capabilities: ['tutorial.view'], grants: [{ branchId: 'branch-a', benefit: 'tutorial.view', status: 'active', validFrom: start, validUntil: end, revoked: false }] };
const evaluate = (f: BenefitFacts | null, asOf = start, p = principal) => evaluateBenefit({ principal: p, deploymentGym: 'gym-a', branchId: 'branch-a', benefit: 'tutorial.view', facts: f, asOf });
test('active benefit permits start instant but denies expiry instant', () => {
 assert.equal(evaluate(facts).allowed, true);
 assert.equal(evaluate(facts, new Date(start.getTime() - 1)).allowed, false);
 assert.equal(evaluate(facts, end).allowed, false);
});
test('gym bundle or owner role alone does not grant member benefit', () => {
 assert.equal(evaluate({ ...facts, grants: [] }).allowed, false);
 assert.equal(evaluate({ ...facts, grants: [] }, start, { ...principal, grants: [{ gymId: 'gym-a', branchId: 'branch-a', role: 'owner' }] }).allowed, false);
 assert.equal(evaluate({ ...facts, capabilities: [] }).reasonCode, 'CAPABILITY_DISABLED');
});
test('upcoming frozen expired cancelled and revoked grants deny access', () => {
 for (const status of ['upcoming', 'frozen', 'expired', 'cancelled'] as const) assert.equal(evaluate({ ...facts, grants: [{ ...facts.grants[0]!, status }] }).allowed, false);
 assert.equal(evaluate({ ...facts, grants: [{ ...facts.grants[0]!, revoked: true }] }).allowed, false);
});
test('missing, foreign, wrong-branch and invalid-time facts fail closed', () => {
 for (const f of [null, { ...facts, gymId: 'gym-b' }, { ...facts, userId: 'user-b' }]) assert.equal(evaluate(f).reasonCode, 'BENEFIT_SOURCE_NOT_READY');
 assert.equal(evaluate({ ...facts, grants: [{ ...facts.grants[0]!, branchId: 'branch-b' }] }).allowed, false);
 assert.equal(evaluate(facts, new Date(NaN)).allowed, false);
 assert.equal(evaluate({ ...facts, grants: [{ ...facts.grants[0]!, validUntil: new Date(NaN) }] }).allowed, false);
 assert.equal(evaluate(facts, start, { ...principal, enabled: false }).allowed, false);
 assert.equal(evaluate(facts, start, { ...principal, grants: [] }).allowed, false);
});
test('unknown benefit denies access', () => {
 assert.equal(evaluateBenefit({ principal, deploymentGym: 'gym-a', branchId: 'branch-a', benefit: 'invented', facts, asOf: start }).reasonCode, 'UNKNOWN_BENEFIT');
});
