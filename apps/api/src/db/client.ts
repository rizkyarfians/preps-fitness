import { createPool } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema.js';
export function createDatabase(url: string) {
 const pool = createPool({ uri: url, connectionLimit: 10, timezone: 'Z' });
 return { pool, db: drizzle(pool, { schema, mode: 'default' }) };
}
export type Database = ReturnType<typeof createDatabase>['db'];
