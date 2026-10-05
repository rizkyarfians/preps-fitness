import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { eq, and } from 'drizzle-orm';
import { readConfig } from '../src/config.js';
import { createRuntime } from '../src/runtime.js';
import { createAuth } from '../src/auth.js';
import { gym, branch, gymUser, branchAccess } from '../src/db/schema.js';
// Run only against a newly migrated, disposable test database.
const config = readConfig(process.env);
if (config.NODE_ENV !== 'test') throw new Error('Integration suite requires NODE_ENV=test');
test('real MySQL auth and branch isolation', async t => {
 const runtime = createRuntime(config);
 const { db, app, pool } = runtime;
 try {
  assert.equal((await db.select().from(gym)).length, 0, 'Use an empty disposable database');
  const auth = createAuth(db, config, true);
  const password = 'test-only-password-123';
  const { user: local } = await auth.api.signUpEmail({ body: { email: 'local@example.test', name: 'Local', password } });
  const { user: foreign } = await auth.api.signUpEmail({ body: { email: 'foreign@example.test', name: 'Foreign', password } });
  await db.insert(gym).values({ id: config.GYM_ID, name: 'Gym A' });
  await db.insert(gymUser).values({ gymId: config.GYM_ID, userId: local.id });
  await db.insert(branch).values([{ id: 'branch-a', gymId: config.GYM_ID, name: 'A' }, { id: 'branch-b', gymId: config.GYM_ID, name: 'B' }]);
  await db.insert(branchAccess).values({ gymId: config.GYM_ID, branchId: 'branch-a', userId: local.id, role: 'member' });
  const agent = request.agent(app);
  const signIn = () => agent.post('/api/v1/auth/sign-in/email').set('Origin', config.WEB_ORIGIN).send({ email: local.email, password });
  await t.test('healthy deployment and database-backed login', async () => {
   await request(app).get('/health/ready').expect(200);
   await request(app).get('/api/v1/me').expect(401);
   await signIn().expect(200);
   const me = await agent.get('/api/v1/me').expect(200);
   assert.equal(me.body.data.user.id, local.id);
   assert.deepEqual(me.body.data.entitlements, []);
   await agent.get('/api/v1/branches/branch-a').expect(200);
   await agent.get('/api/v1/branches/branch-b').expect(403);
  });
  await t.test('public signup is disabled', async () => {
   const res = await request(app).post('/api/v1/auth/sign-up/email').set('Origin', config.WEB_ORIGIN).send({ name: 'Intruder', email: 'new@example.test', password });
   assert.ok(res.status >= 400 && res.status < 500);
  });
  await t.test('account disabling is enforced on the next request', async () => {
   await db.update(gymUser).set({ enabled: false }).where(and(eq(gymUser.userId, local.id), eq(gymUser.gymId, config.GYM_ID)));
   await agent.get('/api/v1/me').expect(403);
   await db.update(gymUser).set({ enabled: true }).where(eq(gymUser.userId, local.id));
  });
  await t.test('logout invalidates a copied session cookie', async () => {
   const loggedIn = await signIn().expect(200);
   const rawCookies = loggedIn.headers['set-cookie'] as unknown as string[];
   const cookie = rawCookies.map(c => c.split(';')[0]).join('; ');
   await agent.post('/api/v1/auth/sign-out').set('Origin', config.WEB_ORIGIN).send({}).expect(200);
   await request(app).get('/api/v1/me').set('Cookie', cookie).expect(401);
  });
  await t.test('other gym access and cross-gym grant insertion are denied', async () => {
   await db.insert(gym).values({ id: 'gym-foreign', name: 'Gym B' });
   await db.insert(gymUser).values({ gymId: 'gym-foreign', userId: foreign.id });
   await db.insert(branch).values({ id: 'branch-foreign', gymId: 'gym-foreign', name: 'Foreign' });
   await assert.rejects(db.insert(branchAccess).values({ gymId: config.GYM_ID, branchId: 'branch-foreign', userId: local.id, role: 'owner' }));
   const foreignAgent = request.agent(app);
   await foreignAgent.post('/api/v1/auth/sign-in/email').set('Origin', config.WEB_ORIGIN).send({ email: foreign.email, password }).expect(200);
   await foreignAgent.get('/api/v1/me').expect(403);
   // Accidental multi-gym data in a dedicated deployment fails readiness.
   await request(app).get('/health/ready').expect(503);
  });
 } finally { await pool.end(); }
});
