import { describe, expect, it } from 'vitest'
import { czyObrazekStopki, rozmiarPliku } from '../lib/crmZalaczniki'

describe('załączniki maili w CRM', () => {
  it('obrazki ze stopki chowamy, PDF-y i zdjęcia od klienta nie', () => {
    expect(czyObrazekStopki({ nazwa: 'image001.png', typ: 'image/png', rozmiar: 4_000 })).toBe(true)
    expect(czyObrazekStopki({ nazwa: 'Outlook-abc123.jpg', typ: 'image/jpeg', rozmiar: 9_000 })).toBe(true)
    expect(czyObrazekStopki({ nazwa: 'obraz', typ: 'image/gif', rozmiar: 1_000 })).toBe(true)
    expect(czyObrazekStopki({ nazwa: 'oferta.pdf', typ: 'application/pdf', rozmiar: 4_000 })).toBe(false)
    expect(czyObrazekStopki({ nazwa: 'IMG_2031.jpg', typ: 'image/jpeg', rozmiar: 2_500_000 })).toBe(false)
    expect(czyObrazekStopki({ nazwa: 'image003.png', typ: 'image/png', rozmiar: 900_000 })).toBe(false)
  })
  it('rozmiar czytelnie', () => {
    expect(rozmiarPliku(300)).toBe('1 KB')
    expect(rozmiarPliku(2_300)).toBe('2 KB')
    expect(rozmiarPliku(1_300_000)).toBe('1,2 MB')
  })
})
