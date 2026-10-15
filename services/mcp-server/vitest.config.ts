import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@don-ti/knowledge': fileURLToPath(new URL('../knowledge/src/index.ts', import.meta.url)),
    },
  },
})
