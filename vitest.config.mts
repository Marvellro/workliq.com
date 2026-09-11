import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // Node, not jsdom: everything under test here is server-side security code.
    environment: 'node',
    include: ['lib/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
