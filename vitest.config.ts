import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Core logic (timeline/player) is environment-free; component tests opt into
    // jsdom with a `// @vitest-environment jsdom` docblock so the fast core
    // suite never pays for a DOM.
    environment: 'node',
    include: ['tests/**/*.spec.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      reporter: ['text', 'json-summary'],
    },
  },
})
