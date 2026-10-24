import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pre-bundling moves MapLibre into .vite/deps, away from the worker file it loads next to itself.
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
