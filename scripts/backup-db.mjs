// Lokalny backup bazy Supabase (druga linia obrony obok backupów Pro).
// Zrzuca pełną kopię przez pg_dump (format custom, skompresowany) do
// katalogu BACKUP_DIR i trzyma ostatnich 8 kopii.
//
// Wymaga w .env:
//   SUPABASE_DB_URL=postgresql://...   (Dashboard → Connect → Session pooler)
// Opcjonalnie:
//   BACKUP_DIR=D:\Backupy             (domyślnie C:\KRCenter-Backups)
//   PG_DUMP_PATH=...\pg_dump.exe      (domyślnie instalacja PostgreSQL 17)
//
// Uruchomienie: npm run backup:db  (harmonogram: Task Scheduler co tydzień)

import { config } from 'dotenv'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
config({ path: path.join(root, '.env') })

const KEEP_LAST = 8

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('❌ Brak SUPABASE_DB_URL w .env (Dashboard → Connect → Session pooler URI)')
  process.exit(1)
}

const candidates = [
  process.env.PG_DUMP_PATH,
  'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
  'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
  'pg_dump',
].filter(Boolean)
let pgDump = null
for (const c of candidates) {
  try {
    execFileSync(c, ['--version'], { stdio: 'pipe' })
    pgDump = c
    break
  } catch {
    /* następny kandydat */
  }
}
if (!pgDump) {
  console.error('❌ Nie znaleziono pg_dump — zainstaluj PostgreSQL albo ustaw PG_DUMP_PATH w .env')
  process.exit(1)
}

const backupDir = process.env.BACKUP_DIR || 'C:\\KRCenter-Backups'
if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })

const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
const outFile = path.join(backupDir, `krcenter-${stamp}.dump`)

console.log(`📦 pg_dump → ${outFile}`)
try {
  // connection string tylko jako argument procesu — nigdy nie logujemy
  execFileSync(pgDump, ['--format=custom', '--no-owner', '--no-privileges', `--file=${outFile}`, dbUrl], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
} catch (e) {
  console.error('❌ pg_dump nie powiódł się (kod wyjścia):', e.status ?? e.message)
  process.exit(1)
}

const size = statSync(outFile).size
console.log(`✅ Backup OK — ${(size / 1024 / 1024).toFixed(1)} MB`)
if (size < 100 * 1024) {
  console.error('⚠️ Podejrzanie mały plik (<100 KB) — sprawdź, czy baza na pewno się zrzuciła!')
  process.exit(1)
}

// sprzątanie: zostaw KEEP_LAST najnowszych
const old = readdirSync(backupDir)
  .filter((f) => f.startsWith('krcenter-') && f.endsWith('.dump'))
  .sort()
  .reverse()
  .slice(KEEP_LAST)
for (const f of old) {
  unlinkSync(path.join(backupDir, f))
  console.log(`🧹 Usunięto starą kopię: ${f}`)
}
console.log(`📁 Kopie w ${backupDir}: ${Math.min(KEEP_LAST, readdirSync(backupDir).filter((f) => f.endsWith('.dump')).length)}`)
