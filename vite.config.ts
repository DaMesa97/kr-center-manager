import dotenv from 'dotenv'
import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

dotenv.config({ path: '.env.sentry-build-plugin' })

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }
const sentryRelease = `kr-center@${pkg.version}`

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const sentryOrg = process.env.SENTRY_ORG || env.SENTRY_ORG
  const sentryProject = process.env.SENTRY_PROJECT || env.SENTRY_PROJECT
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN

  const sentryUploadEnabled = Boolean(sentryAuthToken && sentryOrg && sentryProject)

  return {
    build: {
      sourcemap: 'hidden',
      // pdfmake zawsze będzie ~1 MB — to normalne, nie warto walczyć
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks: {
            // React core
            'vendor-react': ['react', 'react-dom'],
            // Ciężkie biblioteki UI/charty
            'vendor-recharts': ['recharts'],
            // PDF generation
            'vendor-pdfmake': ['pdfmake'],
            // Supabase
            'vendor-supabase': ['@supabase/supabase-js'],
            // Sentry
            'vendor-sentry': ['@sentry/electron'],
            // Icons
            'vendor-lucide': ['lucide-react'],
          },
        },
      },
    },
    plugins: [
      react(),
      electron({
        main: {
          entry: 'electron/main.ts',
          vite: {
            build: {
              sourcemap: 'hidden',
            },
          },
        },
        preload: {
          input: path.join(__dirname, 'electron/preload.ts'),
          vite: {
            build: {
              sourcemap: 'hidden',
            },
          },
        },
        renderer: process.env.NODE_ENV === 'test'
          ? undefined
          : {},
      }),
      sentryVitePlugin({
        org: sentryOrg,
        project: sentryProject,
        authToken: sentryAuthToken,
        disable: !sentryUploadEnabled,
        release: {
          name: sentryRelease,
        },
        sourcemaps: {
          filesToDeleteAfterUpload: ['./dist/**/*.map', './dist-electron/**/*.map'],
        },
      }),
    ],
  }
})
