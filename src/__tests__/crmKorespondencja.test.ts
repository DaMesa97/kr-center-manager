import { describe, expect, it } from 'vitest'
import { bezCytatu, czekaNaOdpowiedz, watek, zajawka } from '../lib/crmKorespondencja'

describe('crmKorespondencja — treść bez cytatu', () => {
  it('ucina historię Gmaila (W dniu … napisał:)', () => {
    const t = 'Dzień dobry,\nproszę o wycenę w kolorze turner.\n\nPozdrawiam\nK. Nowak\n\nW dniu 18.11.2026 o 13:02 Magdalena <m@podrzwi.pl> napisał:\n> Dzień dobry,\n> w załączniku oferta.'
    expect(bezCytatu(t)).toBe('Dzień dobry,\nproszę o wycenę w kolorze turner.\n\nPozdrawiam\nK. Nowak')
  })

  it('ucina blok nagłówków Outlooka (Od: / Wysłano: / Temat:)', () => {
    const t = 'Dziękuję, decyzja w piątek.\r\n\r\nOd: Magdalena <m@podrzwi.pl>\r\nWysłano: wtorek, 18 listopada 2026 13:02\r\nDo: K. Nowak\r\nTemat: Oferta'
    expect(bezCytatu(t)).toBe('Dziękuję, decyzja w piątek.')
  })

  it('ucina „On … wrote:” i „-----Original Message-----”', () => {
    expect(bezCytatu('OK, thanks\n\nOn Tue, Nov 18, 2026 at 1:02 PM Magda <m@x.pl> wrote:\n> hi')).toBe('OK, thanks')
    expect(bezCytatu('Tak.\n-----Original Message-----\nFrom: x')).toBe('Tak.')
  })

  it('pojedynczy „>” w treści zostaje, dwa pod rząd to cytat', () => {
    expect(bezCytatu('wymiar > 100 cm\nok')).toBe('wymiar > 100 cm\nok')
    expect(bezCytatu('ok\n> a\n> b')).toBe('ok')
  })

  it('„Od:” bez dalszych nagłówków to zwykła treść; sam cytat → oryginał', () => {
    expect(bezCytatu('Od: poniedziałku jestem na urlopie')).toBe('Od: poniedziałku jestem na urlopie')
    expect(bezCytatu('> a\n> b')).toBe('> a\n> b')
    expect(bezCytatu(null)).toBe('')
  })

  it('zajawka skraca i spłaszcza', () => {
    expect(zajawka('Dzień dobry,\n\nproszę o wycenę', 100)).toBe('Dzień dobry, proszę o wycenę')
    expect(zajawka('a'.repeat(50), 10)).toBe('aaaaaaaaa…')
  })
})

describe('crmKorespondencja — wątek', () => {
  const maile = [
    { id: '3', kierunek: 'przychodzacy', data: '2026-11-18T13:39:00Z' },
    { id: '1', kierunek: 'przychodzacy', data: '2026-11-18T12:50:00Z' },
    { id: '2', kierunek: 'wychodzacy', data: '2026-11-18T13:02:00Z' },
  ]
  it('sortuje od najstarszego i wie, że klient czeka', () => {
    expect(watek(maile).map((m) => m.id)).toEqual(['1', '2', '3'])
    expect(czekaNaOdpowiedz(maile)?.id).toBe('3')
  })
  it('po naszej odpowiedzi nikt nie czeka; pusty wątek → null', () => {
    expect(czekaNaOdpowiedz([...maile, { id: '4', kierunek: 'wychodzacy', data: '2026-11-18T14:00:00Z' }])).toBeNull()
    expect(czekaNaOdpowiedz([])).toBeNull()
  })
})
