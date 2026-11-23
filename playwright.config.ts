import { defineConfig, devices } from '@playwright/test'

const EDITOR_URL = 'http://127.0.0.1:5300'
const E2E_PROJECT = 'test/fixtures/e2e-canvas'

const edgeOnWindows = process.platform === 'win32'
  ? [{ name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }]
  : []

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: EDITOR_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...edgeOnWindows,
  ],
  webServer: {
    command: `node scripts/start.mjs --project ${E2E_PROJECT}`,
    url: `${EDITOR_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
