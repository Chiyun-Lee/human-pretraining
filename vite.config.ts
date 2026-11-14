import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative base so the build works from a sub-path such as GitHub Pages.
  base: './',
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
})
