import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import * as schema from './db/schema.js';
export function createAuth(db: Database, config: Config, allowSeedSignup = false) {
 if (allowSeedSignup && config.NODE_ENV === 'production') throw new Error('Seed signup forbidden in production');
 return betterAuth({
  appName: 'Preps Fitness', baseURL: config.BETTER_AUTH_URL, basePath: '/api/v1/auth', secret: config.BETTER_AUTH_SECRET,
  trustedOrigins: [config.WEB_ORIGIN], database: drizzleAdapter(db, { provider: 'mysql', schema }),
  emailAndPassword: { enabled: true, disableSignUp: !allowSeedSignup, minPasswordLength: 12 },
  session: { cookieCache: { enabled: false } },
  rateLimit: { enabled: true, window: 60, max: 30 },
  advanced: { useSecureCookies: config.NODE_ENV === 'production', defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' } },
 });
}
