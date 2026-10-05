import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { readConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createAuth } from './auth.js';
import { gym, branch, gymUser, branchAccess } from './db/schema.js';
const config = readConfig(process.env);
if (config.NODE_ENV === 'production') throw new Error('Development seed is forbidden in production');
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 12) throw new Error('Set SEED_PASSWORD (12+ characters)');
const { db, pool } = createDatabase(config.DATABASE_URL);
try {
 const existing = await db.select().from(gym);
 if (existing.length) throw new Error('Seed requires a fresh database; existing data was not changed');
 const auth = createAuth(db, config, true);
 const { user } = await auth.api.signUpEmail({ body: { name: 'Demo Admin', email: 'admin@example.test', password } });
 await db.transaction(async tx => {
  await tx.insert(gym).values({ id: config.GYM_ID, name: 'Demo Gym' });
  await tx.insert(gymUser).values({ gymId: config.GYM_ID, userId: user.id });
  for (const name of ['Central', 'North']) {
   const branchId = randomUUID();
   await tx.insert(branch).values({ id: branchId, gymId: config.GYM_ID, name });
   await tx.insert(branchAccess).values({ gymId: config.GYM_ID, branchId, userId: user.id, role: 'admin' });
  }
 });
 console.log('Seed complete: admin@example.test (password supplied via environment)');
} finally { await pool.end(); }
