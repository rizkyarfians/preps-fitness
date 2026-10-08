import { and, eq, sql } from 'drizzle-orm';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { registrationRouter } from './registration-api.js';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { createDatabase } from './db/client.js';
import { branch, branchAccess, gym, gymUser } from './db/schema.js';
import type { Config } from './config.js';
export function createRuntime(config: Config) {
 const { db, pool } = createDatabase(config.DATABASE_URL);
 const auth = createAuth(db, config);
 const app = createApp({
  registrationRouter: registrationRouter(db, config),
  gymId: config.GYM_ID, webOrigin: config.WEB_ORIGIN, authHandler: toNodeHandler(auth),
  async ready() {
   await db.execute(sql`SELECT 1`);
   const gyms = await db.select({ id: gym.id }).from(gym).limit(2);
   if (gyms.length !== 1 || gyms[0]?.id !== config.GYM_ID) throw new Error('Deployment gym mismatch');
  },
  async resolvePrincipal(req) {
   const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } });
   if (!s) return null;
   const [access] = await db.select().from(gymUser).where(and(eq(gymUser.gymId, config.GYM_ID), eq(gymUser.userId, s.user.id)));
   const grants = access?.enabled ? await db.select().from(branchAccess).where(and(eq(branchAccess.gymId, config.GYM_ID), eq(branchAccess.userId, s.user.id))) : [];
   return { user: { id: s.user.id, name: s.user.name, email: s.user.email }, gymId: config.GYM_ID, enabled: access?.enabled ?? false, grants };
  },
  async getBranch(id) {
   const [b] = await db.select({ id: branch.id, name: branch.name }).from(branch).where(and(eq(branch.id, id), eq(branch.gymId, config.GYM_ID)));
   return b ?? null;
  },
 });
 return { app, auth, db, pool };
}
