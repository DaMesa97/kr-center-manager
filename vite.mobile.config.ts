import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Osobny build WEB (PWA mobilna) — bez Electrona i Sentry-electron.
// Buduje wyłącznie mobile.html → dist-mobile/. Hostuj dist-mobile na Vercel/Netlify/Cloudflare Pages.
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist-mobile',
    emptyOutDir: true,
    rollupOptions: {
      input: 'mobile.html',
    },
  },
  plugins: [react()],
})
