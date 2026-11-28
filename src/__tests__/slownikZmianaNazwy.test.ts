import { describe, expect, it } from 'vitest'
import {
  czyBrakFunkcjiZmianyNazwy,
  liczbaZmienianychWpisow,
  opisZmianyNazwy,
  podsumowanieZmianyNazwy,
  type WynikZmianyNazwy,
} from '../lib/slownikZmianaNazwy'

// D60 (28.11): zmiana nazwy w słowniku — okno podglądu z liczbami z config_option_rename

// liczby z podglądu na kopii produkcji 28.11 (STA / system / NORMAL PLUS RC2), transakcja cofnięta
const NPRC2: WynikZmianyNazwy = {
  podglad: true, zmieniono: false, blokada: null,
  stara: 'NORMAL PLUS RC2', nowa: 'NORMAL PLUS RC2 NOWY', kategoria: 'STA', typ: 'system',
  wykluczenia: 81, wykluczenia_scalone: 0, reguly: 0,
  receptury: 159, receptury_kryteria: 159, receptury_kolumny: 0,
  receptury_nazwy: ['STA / Ościeżnica / NORMAL|NORMAL PLUS|NORMAL PLUS RC2 / ANTRACYT', 'B', 'C'],
  przypisania_magazynow: 0, wymiary: 0,
  zostawiono_stara: true, zlecenia_otwarte: 1, zlecenia_wszystkie: 108, zlecenia_archiwum: 0,
}

describe('liczbaZmienianychWpisow', () => {
  it('sumuje wszystkie miejsca poza słownikiem', () => {
    expect(liczbaZmienianychWpisow(NPRC2)).toBe(240)
    expect(liczbaZmienianychWpisow({ wymiary: 1, receptury_kolumny: 1, receptury_kryteria: 11 })).toBe(13)
    expect(liczbaZmienianychWpisow({})).toBe(0)
  })
})

describe('opisZmianyNazwy', () => {
  it('pokazuje gdzie i ile się zmieni, zamówienia bez zmian, stara nazwa zostaje w recepturach', () => {
    const t = opisZmianyNazwy(NPRC2)
    expect(t).toContain('„NORMAL PLUS RC2" → „NORMAL PLUS RC2 NOWY"')
    expect(t).toContain('(240 wpisów)')
    expect(t).toContain('wykluczenia konfiguratora: 81')
    expect(t).toContain('receptury magazynu: 159')
    expect(t).toContain('; …')
    expect(t).toContain('Zamówienia ze starą nazwą: 108 (otwarte: 1) — zostają bez zmian')
    expect(t).toContain('stara nazwa zostaje obok nowej, dopóki otwarte zlecenia')
    expect(t).not.toContain('reguły Bastion:')
    expect(t).toContain('audyt')
  })

  it('wartość nigdzie nieużyta — tylko słownik', () => {
    const t = opisZmianyNazwy({ stara: '1980 mm', nowa: '1980 mm X' })
    expect(t).toContain('zmieni się tylko słownik')
    expect(t).not.toContain('Zamówienia ze starą nazwą')
  })

  it('reguły Bastion i scalone wykluczenia', () => {
    const t = opisZmianyNazwy({ stara: 'BASIC', nowa: 'BASIC 2', reguly: 5, wykluczenia: 2, wykluczenia_scalone: 1 })
    expect(t).toContain('reguły Bastion: 5')
    expect(t).toContain('w tym 1 zdublowanych — zostaną usunięte')
    expect(t).toContain('W warunkach reguł Bastion stara nazwa zostaje obok nowej')
  })

  it('długie nazwy receptur są skracane', () => {
    const dluga = 'X'.repeat(200)
    const t = opisZmianyNazwy({ stara: 'a', nowa: 'b', receptury: 1, receptury_nazwy: [dluga] })
    expect(t).not.toContain(dluga)
    expect(t).toContain('…')
  })
})

describe('podsumowanieZmianyNazwy / czyBrakFunkcjiZmianyNazwy', () => {
  it('komunikat po zmianie', () => {
    expect(podsumowanieZmianyNazwy(NPRC2)).toContain('przeniesiono do 240 wpisów')
    expect(podsumowanieZmianyNazwy({ nowa: 'X' })).toBe('Nazwa zmieniona na „X"')
  })
  it('rozpoznaje bazę bez funkcji (aplikacja przed migracją)', () => {
    expect(czyBrakFunkcjiZmianyNazwy({ code: 'PGRST202', message: '' })).toBe(true)
    expect(czyBrakFunkcjiZmianyNazwy({ code: '42883' })).toBe(true)
    expect(czyBrakFunkcjiZmianyNazwy({ message: 'Could not find the function public.config_option_rename' })).toBe(true)
    expect(czyBrakFunkcjiZmianyNazwy({ code: 'P0405', message: 'W słowniku jest już wartość' })).toBe(false)
    expect(czyBrakFunkcjiZmianyNazwy(null)).toBe(false)
  })
})
