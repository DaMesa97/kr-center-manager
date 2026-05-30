// Załaduj GH_TOKEN z .env przed uruchomieniem electron-builder
import { config } from 'dotenv'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// Załaduj .env z roota projektu
config({ path: path.join(root, '.env') })

if (!process.env.GH_TOKEN) {
  console.error('❌ GH_TOKEN nie znaleziony w .env — dodaj GH_TOKEN=ghp_xxx do pliku .env')
  process.exit(1)
}

console.log('✅ GH_TOKEN załadowany z .env')
console.log('📦 Uruchamiam electron-builder --publish always...\n')

execSync('npx electron-builder --publish always', {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
})
