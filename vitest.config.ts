import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**', 'test/fixtures/**', 'node_modules/**'],
    environment: 'node',
    passWithNoTests: true,
  },
})
