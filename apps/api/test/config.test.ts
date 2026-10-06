import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
const env = { DATABASE_URL: 'mysql://u:p@localhost/test', GYM_ID: 'a', BETTER_AUTH_SECRET: 'a'.repeat(40), BETTER_AUTH_URL: 'http://localhost:3000', WEB_ORIGIN: 'http://localhost:5173' };
test('reject placeholder secrets and insecure production URLs', () => {
 assert.throws(() => readConfig({ ...env, BETTER_AUTH_SECRET: 'replace-with-at-least-32-random-characters' }));
 assert.throws(() => readConfig({ ...env, NODE_ENV: 'production' }));
 assert.equal(readConfig(env).PORT, 3000);
});
