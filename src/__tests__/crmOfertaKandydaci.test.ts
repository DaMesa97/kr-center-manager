// 28.11 (Tymek): „wysłałem nazwę, link do produktu i ID, a on nadal nie umie wycenić Bastion P-110”.
// Prefiltr kandydatów rozpoznawał tylko Bastiony A-/B-, a ID produktu z tekstu w ogóle nie liczyło się do listy.
import { describe, expect, it } from 'vitest'
// import dynamiczny: plik Deno ciągnie typy z esm.sh, których tsc aplikacji nie zna (typecheck nie wchodzi w funkcje Edge)
const sciezka = '../../supabase/functions/crm-oferta/prompty.ts'
type K = { id: number; nazwa: string; cena: number | null }
const { kandydaci, wzorProduktu } = (await import(/* @vite-ignore */ sciezka)) as {
  kandydaci: (p: K[], a: never, limit?: number) => K[]
  wzorProduktu: (n: string) => string | null
}

const nazwaB = (kod: string) => `Drzwi wewnątrzklatkowe drewniane Bastion ${kod} akustyczne 34–44 dB z ościeżnicą`
const produkty = [
  ...Array.from({ length: 21 }, (_, i) => ({ id: 1000 + i, nazwa: nazwaB(`A-${101 + i}`), cena: 2600 })),
  ...Array.from({ length: 21 }, (_, i) => ({ id: 2000 + i, nazwa: nazwaB(`B-${101 + i}`), cena: 2600 })),
  ...Array.from({ length: 9 }, (_, i) => ({ id: 3000 + i, nazwa: nazwaB(`N-${201 + i}`), cena: 2600 })),
  { id: 48895, nazwa: nazwaB('P-110'), cena: 2600 },
  { id: 73353, nazwa: 'OFERTA SPECJALNA Drzwi wewnątrzklatkowe drewniane Bastion P-110 akustyczne z ościeżnicą', cena: 2600 },
  { id: 4001, nazwa: nazwaB('P-111'), cena: 2600 },
  { id: 5001, nazwa: nazwaB('L-01'), cena: 2600 },
  { id: 5101, nazwa: nazwaB('LUX-401'), cena: 3900 },
  { id: 6005, nazwa: 'Drzwi wewnątrzklatkowe akustyczne 44 dB antywłamaniowe RC3 stalowe Bastion Titan G-05 z ościeżnicą', cena: 5000 },
]
const analiza = (model: string, extra: Record<string, unknown> = {}) =>
  ({ kategoria: 'bastion', dane: { model }, potrzeba: `Drzwi wejściowe do mieszkania Bastion ${model}`, ...extra }) as never

describe('crm-oferta: kandydaci dla modeli Bastion', () => {
  it('P-110 trafia na listę (dotąd: tylko A-/B-, lista zapchana innymi Bastionami)', () => {
    const ids = kandydaci(produkty, analiza('P-110')).map((p) => p.id)
    expect(ids.slice(0, 2).sort()).toEqual([48895, 73353])
  })
  it('N-, L-, LUX- też rozpoznawane', () => {
    expect(kandydaci(produkty, analiza('N-203'))[0].id).toBe(3002)
    expect(kandydaci(produkty, analiza('L-01'))[0].id).toBe(5001)
    expect(kandydaci(produkty, analiza('LUX-401'))[0].id).toBe(5101)
  })
  it('A- i Titan G- działają jak wcześniej', () => {
    expect(kandydaci(produkty, analiza('A-104'))[0].id).toBe(1003)
    expect(kandydaci(produkty, analiza('G-05', { kategoria: 'titan' }))[0].id).toBe(6005)
  })
  it('ID produktu wpisane przez handlowca zawsze na liście, na pierwszym miejscu', () => {
    const a = analiza('', { potrzeba: 'drzwi Bastion do mieszkania', odpowiedzi_handlowca: 'chodzi o ten produkt → ID 48895' })
    expect(kandydaci(produkty, a)[0].id).toBe(48895)
    const link = analiza('', { potrzeba: 'drzwi Bastion', poprawka_handlowca: 'https://podrzwi.pl/?p=4001' })
    expect(kandydaci(produkty, link)[0].id).toBe(4001)
  })
  it('wzorProduktu rozpoznaje nowe przedrostki', () => {
    expect(wzorProduktu(nazwaB('P-110'))).toBe('p-110')
    expect(wzorProduktu(nazwaB('L-01'))).toBe('l-01')
    expect(wzorProduktu(nazwaB('A-104'))).toBe('a-104')
    expect(wzorProduktu('Drzwi Otto 49 w systemie Alu')).toBe('otto 49')
  })
})
