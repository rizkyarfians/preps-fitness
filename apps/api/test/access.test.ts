import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Principal } from '../src/access.js';
const principal: Principal = { user: { id: 'u1', name: 'Demo', email: 'demo@example.test' }, gymId: 'gym-a', enabled: true, grants: [{ gymId: 'gym-a', branchId: 'branch-a', role: 'member' }] };
function app(p: Principal | null) {
 return createApp({ gymId: 'gym-a', webOrigin: 'http://localhost:5173', authHandler: (_req, res) => { res.sendStatus(404); }, resolvePrincipal: async () => p, getBranch: async id => ({ id, name: 'Demo' }), ready: async () => {} });
}
test('anonymous requests receive 401 with a request ID', async () => {
 const res = await request(app(null)).get('/api/v1/me').expect(401);
 assert.equal(res.body.error.reasonCode, 'UNAUTHENTICATED'); assert.ok(res.body.error.requestId);
});
test('disabled and foreign-gym principals are denied', async () => {
 for (const p of [{ ...principal, enabled: false }, { ...principal, gymId: 'gym-b' }]) await request(app(p)).get('/api/v1/me').expect(403);
});
test('branch IDs cannot bypass grants, even with forged gym headers', async () => {
 await request(app(principal)).get('/api/v1/branches/branch-a').expect(200);
 await request(app(principal)).get('/api/v1/branches/branch-b').set('X-Gym-Id', 'gym-b').expect(403);
 await request(app({ ...principal, grants: [{ gymId: 'gym-b', branchId: 'branch-a', role: 'owner' }] })).get('/api/v1/branches/branch-a').expect(403);
});
test('/me does not infer paid benefits or expose session tokens', async () => {
 const res = await request(app(principal)).get('/api/v1/me').expect(200);
 assert.deepEqual(res.body.data.entitlements, []); assert.equal(res.body.data.session, undefined);
 assert.deepEqual(res.body.data.branchAccess, [{ branchId: 'branch-a', role: 'member' }]);
});
