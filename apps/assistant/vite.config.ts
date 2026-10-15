import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/node'
import { defineConfig } from 'vitest/config'

const knowledgeSource = fileURLToPath(
  new URL('../../services/knowledge/src/index.ts', import.meta.url),
)

export default defineConfig({
  plugins: [
    vue(),
    devServer({
      entry: 'backend/app.ts',
      adapter,
      // Всё, кроме /api/*, отдаёт сам Vite (index.html, /src/*, /@vite/*) —
      // Hono-приложение согласно спеке 004 обслуживает только API на одном порту.
      exclude: [/^(?!\/api\/)/],
    }),
  ],
  resolve: {
    alias: {
      '@don-ti/knowledge': knowledgeSource,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
