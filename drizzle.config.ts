import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
export default defineConfig({ dialect: 'mysql', schema: './apps/api/src/db/schema.ts', out: './db/migrations', dbCredentials: { url: process.env.DATABASE_URL } });
