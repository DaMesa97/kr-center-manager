import { describe, expect, it, vi } from 'vitest'
import {
  KOMUNIKAT_ZA_DUZE,
  KOMUNIKAT_ZLY_FORMAT,
  ZDJECIE_LIMIT_BUCKETU,
  czyWyslacOryginal,
  przygotujZdjecie,
  rozszerzenieDlaTypu,
  wymiaryPoZmniejszeniu,
  type ObrazZdjecia,
  type ZaleznosciZdjecia,
} from '../lib/zmniejszZdjecie'

// D67 (28.11): zmniejszanie zdjęć z telefonu przed wysłaniem (1600 px, JPEG)

function plik(rozmiar: number, typ: string): Blob {
  // Blob o zadanym rozmiarze bez alokowania prawdziwych danych zdjęcia
  return new Blob([new Uint8Array(rozmiar)], { type: typ })
}

function zalezn(szer: number, wys: number, wynik: Blob | null | 'blad-dekodowania' = new Blob([new Uint8Array(400_000)], { type: 'image/jpeg' })) {
  const zamknij = vi.fn()
  const koduj = vi.fn(async () => (wynik === 'blad-dekodowania' ? null : wynik))
  const dekoduj = vi.fn(async (): Promise<ObrazZdjecia> => {
    if (wynik === 'blad-dekodowania') throw new Error('nie umiem HEIC')
    return { szer, wys, zrodlo: {}, zamknij }
  })
  const z: ZaleznosciZdjecia = { dekoduj, koduj }
  return { z, koduj, dekoduj, zamknij }
}

describe('wymiaryPoZmniejszeniu', () => {
  it('zmniejsza dłuższy bok do 1600 px z zachowaniem proporcji', () => {
    expect(wymiaryPoZmniejszeniu(4000, 3000)).toEqual({ szer: 1600, wys: 1200 })
    expect(wymiaryPoZmniejszeniu(3024, 4032)).toEqual({ szer: 1200, wys: 1600 })
  })
  it('nie powiększa małych zdjęć', () => {
    expect(wymiaryPoZmniejszeniu(1200, 800)).toEqual({ szer: 1200, wys: 800 })
  })
  it('złe wymiary → 0', () => {
    expect(wymiaryPoZmniejszeniu(0, 100)).toEqual({ szer: 0, wys: 0 })
    expect(wymiaryPoZmniejszeniu(NaN, 100)).toEqual({ szer: 0, wys: 0 })
  })
  it('bardzo wąski pasek nie daje 0 px', () => {
    expect(wymiaryPoZmniejszeniu(10000, 2)).toEqual({ szer: 1600, wys: 1 })
  })
})

describe('czyWyslacOryginal / rozszerzenieDlaTypu', () => {
  it('mały JPG w limicie wymiarów idzie bez zmian', () => {
    expect(czyWyslacOryginal({ type: 'image/jpeg', size: 500_000 }, 1600, 1200)).toBe(true)
  })
  it('duży plik, za duże wymiary albo HEIC — przekodowanie', () => {
    expect(czyWyslacOryginal({ type: 'image/jpeg', size: 3_000_000 }, 1600, 1200)).toBe(false)
    expect(czyWyslacOryginal({ type: 'image/jpeg', size: 500_000 }, 4000, 3000)).toBe(false)
    expect(czyWyslacOryginal({ type: 'image/heic', size: 500_000 }, 1000, 800)).toBe(false)
    expect(czyWyslacOryginal({ type: '', size: 500_000 }, 1000, 800)).toBe(false)
  })
  it('rozszerzenia', () => {
    expect(rozszerzenieDlaTypu('image/jpeg')).toBe('jpg')
    expect(rozszerzenieDlaTypu('image/png')).toBe('png')
    expect(rozszerzenieDlaTypu('image/heic')).toBe('jpg')
  })
})

describe('przygotujZdjecie', () => {
  it('duże zdjęcie z telefonu → JPEG 1600 px', async () => {
    const { z, koduj, zamknij } = zalezn(4032, 3024)
    const w = await przygotujZdjecie(plik(6_000_000, 'image/jpeg'), z)
    expect(w.ok).toBe(true)
    if (!w.ok) return
    expect(w.zmniejszone).toBe(true)
    expect(w.typ).toBe('image/jpeg')
    expect(w.rozszerzenie).toBe('jpg')
    expect(koduj).toHaveBeenCalledWith(expect.anything(), 1600, 1200, expect.any(Number))
    expect(zamknij).toHaveBeenCalled()
  })

  it('HEIC odczytany przez przeglądarkę (Safari) → JPEG', async () => {
    const { z } = zalezn(3024, 4032)
    const w = await przygotujZdjecie(plik(2_500_000, 'image/heic'), z)
    expect(w.ok && w.typ === 'image/jpeg' && w.zmniejszone).toBe(true)
  })

  it('HEIC nieodczytany (Chrome) → komunikat o formacie, bez wysyłania', async () => {
    const { z, koduj } = zalezn(0, 0, 'blad-dekodowania')
    const w = await przygotujZdjecie(plik(2_500_000, 'image/heic'), z)
    expect(w).toEqual({ ok: false, blad: KOMUNIKAT_ZLY_FORMAT })
    expect(koduj).not.toHaveBeenCalled()
  })

  it('nieodczytany, ale JPG w limicie → oryginał (bucket go przyjmie)', async () => {
    const { z } = zalezn(0, 0, 'blad-dekodowania')
    const p = plik(3_000_000, 'image/jpeg')
    const w = await przygotujZdjecie(p, z)
    expect(w.ok && w.blob === p && !w.zmniejszone).toBe(true)
  })

  it('nieodczytany JPG ponad 10 MB → komunikat „za duże”', async () => {
    const { z } = zalezn(0, 0, 'blad-dekodowania')
    const w = await przygotujZdjecie(plik(ZDJECIE_LIMIT_BUCKETU + 1, 'image/jpeg'), z)
    expect(w).toEqual({ ok: false, blad: KOMUNIKAT_ZA_DUZE })
  })

  it('mały PNG idzie bez zmian (z właściwym rozszerzeniem)', async () => {
    const { z, koduj } = zalezn(800, 600)
    const p = plik(300_000, 'image/png')
    const w = await przygotujZdjecie(p, z)
    expect(w.ok && w.blob === p && w.rozszerzenie === 'png' && w.typ === 'image/png').toBe(true)
    expect(koduj).not.toHaveBeenCalled()
  })

  it('canvas nie zwrócił pliku → oryginał, jeśli bucket go przyjmie; inaczej komunikat', async () => {
    const a = zalezn(4000, 3000, null)
    const jpg = plik(5_000_000, 'image/jpeg')
    const w1 = await przygotujZdjecie(jpg, a.z)
    expect(w1.ok && w1.blob === jpg).toBe(true)
    const b = zalezn(4000, 3000, null)
    const w2 = await przygotujZdjecie(plik(5_000_000, 'image/heic'), b.z)
    expect(w2.ok).toBe(false)
  })

  it('wyjątek przy kodowaniu nie wywraca wysyłania i zamyka obraz', async () => {
    const zamknij = vi.fn()
    const z: ZaleznosciZdjecia = {
      dekoduj: async () => ({ szer: 4000, wys: 3000, zrodlo: {}, zamknij }),
      koduj: async () => { throw new Error('canvas za duży') },
    }
    const jpg = plik(5_000_000, 'image/jpeg')
    const w = await przygotujZdjecie(jpg, z)
    expect(w.ok && w.blob === jpg).toBe(true)
    expect(zamknij).toHaveBeenCalled()
  })
})
