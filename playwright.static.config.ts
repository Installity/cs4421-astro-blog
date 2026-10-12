import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testMatch: 'news-lifecycle.spec.ts',
  use: { ...config.use, baseURL: 'http://127.0.0.1:4343' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4343',
    url: 'http://127.0.0.1:4343',
    reuseExistingServer: !process.env.CI,
  },
});
