import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/e2e/**', 'test/fixtures/**', 'node_modules/**'],
    environment: 'node',
    passWithNoTests: true,
    // Spawning git is several times slower on Windows runners; the edsync tests spawn it many times per test.
    testTimeout: process.platform === 'win32' ? 30_000 : 5_000,
  },
})
