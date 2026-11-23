import { defineConfig, devices } from '@playwright/test'

const EDITOR_URL = 'http://127.0.0.1:5300'

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
})
