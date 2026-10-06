import { defineConfig } from '@playwright/test';

if (process.env.NODE_ENV !== 'test' || process.env.E2E_DISPOSABLE_DATABASE !== 'yes') {
  throw new Error('Real browser tests require NODE_ENV=test and E2E_DISPOSABLE_DATABASE=yes');
}
export default defineConfig({
  testDir: './integration',
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://localhost:5173', headless: true, trace: 'off' },
  webServer: [
    { command: 'npm --prefix ../.. start', url: 'http://localhost:3000/health/ready', reuseExistingServer: false },
    { command: 'npm run preview -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: false },
  ],
  reporter: 'list',
});
