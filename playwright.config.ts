import {defineConfig, devices} from '@playwright/test';

/**
 * Configuración de Playwright para pruebas End-to-End (E2E) de Ojo de Buey (OxEye).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  // The Gestor logístico is a lazy chunk: on a cold dev server with parallel
  // workers its first compile can exceed the default 5 s of `expect`.
  expect: {timeout: 10_000},
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']},
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
