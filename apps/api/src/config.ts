import { z } from 'zod';
const schema = z.object({
 NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
 PORT: z.coerce.number().int().min(1).max(65535).default(3000),
 DATABASE_URL: z.string().url().refine(v => v.startsWith('mysql://'), 'MySQL URL required'),
 GYM_ID: z.string().min(1),
 BETTER_AUTH_SECRET: z.string().min(32).refine(v => !v.startsWith('replace-'), 'Set a random secret'),
 BETTER_AUTH_URL: z.string().url(), WEB_ORIGIN: z.string().url(),
});
export function readConfig(env: NodeJS.ProcessEnv) {
 const c = schema.parse(env);
 if (c.NODE_ENV === 'production' && [c.BETTER_AUTH_URL, c.WEB_ORIGIN].some(u => new URL(u).protocol !== 'https:')) throw new Error('Production requires HTTPS');
 return c;
}
export type Config = ReturnType<typeof readConfig>;
