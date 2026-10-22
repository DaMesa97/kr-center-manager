// Krok 2 release'u: weryfikacja draftu i upublicznienie.
// `npm run release` wgrywa DRAFT (releaseType w electron-builder.json5) —
// updater go nie widzi, więc klient nie trafia w okno między Setup.exe a latest.yml.
// Ten skrypt sprawdza, czy wszystkie assets są wgrane, ustawia opis z pliku
// i dopiero wtedy zdejmuje draft. Bez niego release zostaje NIEWIDOCZNY.
//
// Użycie: node scripts/publish-release.mjs [ścieżka-do-release-notes.md]
import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
config({ path: path.join(root, '.env') })

const OWNER = 'DaMesa97'
const REPO = 'kr-center-manager'

const token = process.env.GH_TOKEN
if (!token) {
  console.error('❌ GH_TOKEN nie znaleziony w .env')
  process.exit(1)
}

const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
const tag = `v${version}`

const gh = (url, init = {}) =>
  fetch(`https://api.github.com/repos/${OWNER}/${REPO}${url}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      ...init.headers,
    },
  })

// Drafty NIE są widoczne pod /releases/tags/:tag — trzeba listować /releases
const listRes = await gh('/releases?per_page=30')
if (!listRes.ok) {
  console.error(`❌ GitHub API ${listRes.status} przy listowaniu release'ów`)
  process.exit(1)
}
const releases = await listRes.json()
const release = releases.find((r) => r.tag_name === tag)
if (!release) {
  console.error(`❌ Nie znaleziono release'u ${tag} (również wśród draftów)`)
  process.exit(1)
}

const assets = release.assets ?? []
const ok = (pred, label) => {
  const a = assets.find(pred)
  const good = a && a.state === 'uploaded' && a.size > 0
  console.log(`${good ? '✅' : '❌'} ${label}: ${a ? `${a.name} (${(a.size / 1024 / 1024).toFixed(1)} MB, ${a.state})` : 'BRAK'}`)
  return good
}
const setupOk = ok((a) => a.name.endsWith('Setup.exe'), 'Setup.exe')
const ymlOk = ok((a) => a.name === 'latest.yml', 'latest.yml')
const blockmapOk = ok((a) => a.name.endsWith('.blockmap'), 'blockmap')
if (!setupOk || !ymlOk) {
  console.error('❌ Brak kompletu assets — release zostaje draftem. Popraw build i odpal ponownie.')
  process.exit(1)
}
if (!blockmapOk) console.log('⚠️ brak blockmap — update zadziała, ale bez delty (pełne pobranie)')

const notesPath = process.argv[2]
const body = notesPath ? readFileSync(notesPath, 'utf8') : (release.body || '')

if (!release.draft) {
  console.log(`ℹ️ ${tag} już jest publiczny — tylko odświeżam opis`)
}
const patchRes = await gh(`/releases/${release.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ draft: false, name: tag, body }),
})
if (!patchRes.ok) {
  console.error(`❌ PATCH ${patchRes.status}: ${await patchRes.text()}`)
  process.exit(1)
}
console.log(`✅ ${tag} opublikowany (draft → public)`)

// Potwierdzenie z perspektywy updatera: publiczny latest.yml musi zwracać 200
const publicUrl = `https://github.com/${OWNER}/${REPO}/releases/latest/download/latest.yml`
for (let i = 1; i <= 6; i++) {
  const res = await fetch(publicUrl, { redirect: 'follow' })
  if (res.ok) {
    const text = await res.text()
    const line = text.split('\n').find((l) => l.startsWith('version:'))
    console.log(`✅ latest.yml publiczny (200), ${line?.trim()}`)
    if (!line?.includes(version)) {
      console.error(`❌ latest.yml wskazuje inną wersję niż ${version}!`)
      process.exit(1)
    }
    process.exit(0)
  }
  console.log(`⏳ latest.yml jeszcze ${res.status}, próba ${i}/6...`)
  await new Promise((r) => setTimeout(r, 5000))
}
console.error('❌ latest.yml wciąż niedostępny publicznie — sprawdź release na GitHubie')
process.exit(1)
