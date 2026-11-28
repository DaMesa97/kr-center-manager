// D20 (28.11, RODO): usuwanie klienta / oferty razem z plikami w funkcji serwerowej crm-dokumenty (usuwanie.ts).
import { describe, expect, it } from 'vitest'
// import dynamiczny: plik Deno (typy z esm.sh tylko jako `import type`, więc działa w vitest)
const sciezka = '../../supabase/functions/crm-dokumenty/usuwanie.ts'
type Wiersz = Record<string, unknown>
const mod = (await import(/* @vite-ignore */ sciezka)) as {
  plikiOferty: (o: Wiersz) => string[]
  plikiDoSkasowania: (wlasne: string[], zajete: Iterable<string>) => string[]
  usun: (db: unknown, uzytk: unknown, body: Wiersz) => Promise<Wiersz>
  sprzatnijPliki: (db: unknown, usun: boolean) => Promise<Wiersz>
}

const L1 = '11111111-1111-4111-8111-111111111111'
const L2 = '22222222-2222-4222-8222-222222222222'
const LX = '99999999-9999-4999-8999-999999999999' // klient usunięty dawniej
const O1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const O2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** Minimalna atrapa klienta Supabase: select/eq/neq/in/maybeSingle, delete({count}).eq, storage.list/remove. */
function atrapa(tabele: Record<string, Wiersz[]>, pliki: Record<string, string[]>, log: string[]) {
  const zapytanie = (tabela: string) => {
    let wiersze = [...(tabele[tabela] ?? [])]
    let kasuj = false
    const q = {
      select: () => q,
      delete: () => { kasuj = true; return q },
      eq: (k: string, v: unknown) => { wiersze = wiersze.filter((w) => w[k] === v); return q },
      neq: (k: string, v: unknown) => { wiersze = wiersze.filter((w) => w[k] !== v); return q },
      in: (k: string, v: unknown[]) => { wiersze = wiersze.filter((w) => v.includes(w[k])); return q },
      maybeSingle: async () => ({ data: wiersze[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown) => {
        if (kasuj) {
          log.push(`delete ${tabela} ${wiersze.map((w) => w.id).join(',')}`)
          tabele[tabela] = (tabele[tabela] ?? []).filter((w) => !wiersze.includes(w))
          return Promise.resolve({ error: null, count: wiersze.length }).then(ok)
        }
        return Promise.resolve({ data: wiersze, error: null }).then(ok)
      },
    }
    return q
  }
  const storage = {
    from: (bucket: string) => ({
      list: async (katalog: string) => {
        const wszystkie = pliki[bucket] ?? []
        if (!katalog) return { data: [...new Set(wszystkie.map((p) => p.split('/')[0]))].map((n) => ({ name: n, id: null })), error: null }
        return { data: wszystkie.filter((p) => p.startsWith(katalog + '/')).map((p) => ({ name: p.slice(katalog.length + 1), id: 'x' })), error: null }
      },
      remove: async (lista: string[]) => {
        log.push(`remove ${bucket} ${[...lista].sort().join(',')}`)
        pliki[bucket] = (pliki[bucket] ?? []).filter((p) => !lista.includes(p))
        return { data: lista.map((name) => ({ name })), error: null }
      },
    }),
  }
  return { from: zapytanie, storage }
}

function swiat() {
  const tabele: Record<string, Wiersz[]> = {
    leady: [{ id: L1 }, { id: L2 }],
    oferty: [
      { id: O1, lead_id: L1, plik_pdf: `${L1}/oferta-2026-11-001-v1.pdf`, konfiguracja_plik: `${L1}/konfiguracja-1.pdf`, konfiguracja_pliki: [`${L1}/konfiguracja-1.pdf`] },
      // druga wersja tej samej oferty dzieli plik konfiguracji
      { id: O2, lead_id: L1, plik_pdf: `${L1}/oferta-2026-11-001-v2.pdf`, konfiguracja_plik: null, konfiguracja_pliki: [`${L1}/konfiguracja-1.pdf`] },
    ],
    dokumenty: [{ id: 'd1', lead_id: L1, plik_pdf: `${L1}/umowa-01-11-2026.pdf` }],
  }
  const pliki: Record<string, string[]> = {
    'crm-dokumenty': [
      `${L1}/oferta-2026-11-001-v1.pdf`, `${L1}/oferta-2026-11-001-v2.pdf`, `${L1}/konfiguracja-1.pdf`, `${L1}/umowa-01-11-2026.pdf`,
      `${L1}/karta-pomiarowa-2026-11-18.pdf`, `${L2}/karta-pomiarowa-2026-11-19.pdf`, `${LX}/protokol-01-11-2026.pdf`, 'szablon/logo.png',
    ],
    'crm-nagrania': [`${L1}/1795.webm`],
  }
  return { tabele, pliki }
}

describe('D20: pliki przy usuwaniu klienta / oferty', () => {
  it('plikiOferty: PDF + konfiguracja bez duplikatów, pustych i szablonu', () => {
    expect(mod.plikiOferty({ plik_pdf: 'a/x.pdf', konfiguracja_plik: 'a/k.pdf', konfiguracja_pliki: ['a/k.pdf', '', 'szablon/logo.png'] })).toEqual(['a/x.pdf', 'a/k.pdf'])
    expect(mod.plikiDoSkasowania(['a', 'b'], ['b'])).toEqual(['a'])
  })

  it('klient: najpierw rekord (jako użytkownik), potem wszystkie jego pliki i nagrania', async () => {
    const { tabele, pliki } = swiat()
    const log: string[] = []
    const db = atrapa(tabele, pliki, log)
    const wynik = await mod.usun(db, db, { lead_id: L1 })
    expect(log[0]).toBe(`delete leady ${L1}`)
    expect(log.some((l) => l.startsWith('remove crm-dokumenty') && l.includes('karta-pomiarowa-2026-11-18') && l.includes('umowa-01-11-2026'))).toBe(true)
    expect(log).toContain(`remove crm-nagrania ${L1}/1795.webm`)
    expect(pliki['crm-dokumenty']).toEqual([`${L2}/karta-pomiarowa-2026-11-19.pdf`, `${LX}/protokol-01-11-2026.pdf`, 'szablon/logo.png'])
    expect(wynik).toMatchObject({ ok: true, usuniety: 'klient', plikow_usunietych: 6, blad_plikow: null })
  })

  it('oferta: kasuje jej PDF, plik konfiguracji wspólny z inną wersją zostaje', async () => {
    const { tabele, pliki } = swiat()
    const log: string[] = []
    const db = atrapa(tabele, pliki, log)
    const wynik = await mod.usun(db, db, { oferta_id: O1 })
    expect(log).toEqual([`delete oferty ${O1}`, `remove crm-dokumenty ${L1}/oferta-2026-11-001-v1.pdf`])
    expect(pliki['crm-dokumenty']).toContain(`${L1}/konfiguracja-1.pdf`)
    expect(wynik).toMatchObject({ ok: true, usuniety: 'oferta', plikow_usunietych: 1 })
  })

  it('zły identyfikator / brak klienta — nic nie kasuje', async () => {
    const { tabele, pliki } = swiat()
    const log: string[] = []
    const db = atrapa(tabele, pliki, log)
    await expect(mod.usun(db, db, { lead_id: 'abc' })).rejects.toThrow(/niepoprawny/)
    await expect(mod.usun(db, db, { lead_id: LX })).rejects.toThrow(/Nie ma takiego klienta/)
    await expect(mod.usun(db, db, {})).rejects.toThrow(/lead_id albo oferta_id/)
    expect(log).toEqual([])
  })

  it('porządki: podgląd nic nie kasuje; usunięcie tylko plików po usuniętych klientach', async () => {
    const { tabele, pliki } = swiat()
    const log: string[] = []
    const db = atrapa(tabele, pliki, log)
    const podglad = await mod.sprzatnijPliki(db, false)
    expect(podglad).toMatchObject({ tryb: 'podglad', po_usunietych_klientach: 1, usuniete: 0 })
    expect(podglad.bez_odwolania).toEqual([`${L1}/karta-pomiarowa-2026-11-18.pdf`, `${L2}/karta-pomiarowa-2026-11-19.pdf`])
    expect(log).toEqual([])
    const teraz = await mod.sprzatnijPliki(db, true)
    expect(teraz).toMatchObject({ tryb: 'usun', usuniete: 1 })
    expect(log).toEqual([`remove crm-dokumenty ${LX}/protokol-01-11-2026.pdf`])
  })
})
