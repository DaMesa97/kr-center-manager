import { describe, expect, it } from 'vitest'
import { decyzjaLeada, podsumowanieBezPotencjalu, potencjalZAnalizy, PREFIKS_BEZ_POTENCJALU } from '../../supabase/functions/crm-call-ingest/potencjal'
import { SCHEMA_ANALIZA, ZASADA_POTENCJALU, systemAnalizy, systemAnalizyMaila, systemAnalizyNotatki } from '../../supabase/functions/crm-call-ingest/prompt'
import { doPrzejrzenia, listaBezKlienta, numerZRozmowy, potencjalZAnalizy as potencjalApp } from '../lib/crmBezKlienta'
import type { CrmMail, CrmRozmowa } from '../types/crm'

// Zgłoszenie właściciela 28.11: „musimy umieć odróżnić coś, w czym jest potencjał sprzedażowy, od śmieci”.
describe('decyzjaLeada — czy z analizy założyć klienta', () => {
  it('nowy kontakt, zapytanie bez potencjału (przykład ze zgłoszenia) → bez klienta', () => {
    expect(decyzjaLeada({ typ: 'zapytanie', potencjal: 'nie' }, false, true)).toBe('bez_potencjalu')
    expect(decyzjaLeada({ typ: 'klient', potencjal: 'nie' }, false, true)).toBe('bez_potencjalu')
  })

  it('nowy kontakt z potencjałem tak / niepewny → nowy klient', () => {
    expect(decyzjaLeada({ typ: 'zapytanie', potencjal: 'tak' }, false)).toBe('nowy')
    expect(decyzjaLeada({ typ: 'zapytanie', potencjal: 'niepewny' }, false)).toBe('nowy')
    expect(decyzjaLeada({ typ: 'klient', potencjal: 'tak' }, false)).toBe('nowy')
  })

  it('starsza analiza bez pola potencjal albo bzdura → jak dotąd (nowy klient)', () => {
    expect(decyzjaLeada({ typ: 'zapytanie' }, false)).toBe('nowy')
    expect(decyzjaLeada({ typ: 'zapytanie', potencjal: 'moze' }, false)).toBe('nowy')
    expect(decyzjaLeada({ typ: 'zapytanie', potencjal: null }, false)).toBe('nowy')
  })

  it('reklamacja zawsze zakłada klienta, nawet z potencjałem nie', () => {
    expect(decyzjaLeada({ typ: 'reklamacja', potencjal: 'nie' }, false)).toBe('nowy')
  })

  it('istniejący klient — bez zmian (historia klienta), potencjał bez znaczenia', () => {
    expect(decyzjaLeada({ typ: 'zapytanie', potencjal: 'nie' }, true)).toBe('istniejacy')
    expect(decyzjaLeada({ typ: 'klient', potencjal: 'nie' }, true)).toBe('istniejacy')
    expect(decyzjaLeada({ typ: 'reklamacja', potencjal: 'tak' }, true)).toBe('istniejacy')
  })

  it('sprawy niesprzedażowe i brak numeru → bez klienta jak dotąd', () => {
    for (const typ of ['status', 'dostawca', 'spam', 'inne', '', undefined]) {
      expect(decyzjaLeada({ typ, potencjal: 'tak' }, false)).toBe('bez_leada')
      expect(decyzjaLeada({ typ, potencjal: 'tak' }, true)).toBe('bez_leada')
    }
    expect(decyzjaLeada({ typ: 'zapytanie', potencjal: 'tak' }, false, false)).toBe('bez_leada')
    expect(decyzjaLeada({ typ: 'reklamacja', potencjal: 'tak' }, false, false)).toBe('bez_leada')
  })

  it('potencjalZAnalizy: wielkość liter i spacje, brak → niepewny', () => {
    expect(potencjalZAnalizy({ potencjal: ' NIE ' })).toBe('nie')
    expect(potencjalZAnalizy({ potencjal: 'tak' })).toBe('tak')
    expect(potencjalZAnalizy({})).toBe('niepewny')
    expect(potencjalZAnalizy(null)).toBe('niepewny')
  })
})

describe('podsumowanieBezPotencjalu', () => {
  it('dopisek „Bez potencjału: <powód>” na końcu podsumowania', () => {
    expect(podsumowanieBezPotencjalu('Klientka szukała drzwi od ręki', 'chciała inny kolor, zrezygnowała'))
      .toBe('Klientka szukała drzwi od ręki. Bez potencjału: chciała inny kolor, zrezygnowała.')
    expect(podsumowanieBezPotencjalu('Pytał o cenę.', 'rozmowa informacyjna.')).toBe('Pytał o cenę. Bez potencjału: rozmowa informacyjna.')
  })

  it('bez powodu / bez podsumowania / powtórka przy ponowieniu', () => {
    expect(podsumowanieBezPotencjalu('Pomyłka.', '')).toBe('Pomyłka. Bez potencjału: brak chęci zakupu.')
    expect(podsumowanieBezPotencjalu('', 'pomyłka')).toBe('Bez potencjału: pomyłka.')
    const raz = podsumowanieBezPotencjalu('Pomyłka.', 'zły numer')
    expect(podsumowanieBezPotencjalu(raz, 'zły numer')).toBe(raz)
    expect(raz.split(PREFIKS_BEZ_POTENCJALU)).toHaveLength(2)
  })
})

describe('schemat i prompt analizy — pole potencjal', () => {
  const props = SCHEMA_ANALIZA.properties as Record<string, { type: string; enum?: readonly string[] }>

  it('potencjal: enum tak / nie / niepewny; powod_braku_potencjalu: tekst; oba wymagane (structured outputs)', () => {
    expect(props.potencjal.type).toBe('string')
    expect([...(props.potencjal.enum ?? [])]).toEqual(['tak', 'nie', 'niepewny'])
    expect(props.powod_braku_potencjalu.type).toBe('string')
    expect(SCHEMA_ANALIZA.required).toContain('potencjal')
    expect(SCHEMA_ANALIZA.required).toContain('powod_braku_potencjalu')
  })

  it('każde pole ze schematu jest wymagane i odwrotnie (wymóg trybu json_schema)', () => {
    expect([...SCHEMA_ANALIZA.required].sort()).toEqual(Object.keys(SCHEMA_ANALIZA.properties).sort())
    expect(SCHEMA_ANALIZA.additionalProperties).toBe(false)
  })

  it('reguły potencjału trafiają do promptu rozmowy i maila; notatka zawsze tak', () => {
    expect(systemAnalizy()).toContain(ZASADA_POTENCJALU)
    expect(systemAnalizyMaila()).toContain(ZASADA_POTENCJALU)
    expect(systemAnalizyNotatki()).toContain('`potencjal` = tak')
    // przykład ze zgłoszenia i kluczowe reguły „nie”
    expect(ZASADA_POTENCJALU).toMatch(/od ręki/)
    expect(ZASADA_POTENCJALU).toMatch(/odmawia wyceny na maila/)
    expect(ZASADA_POTENCJALU).toMatch(/pomyłka/)
    expect(ZASADA_POTENCJALU).toMatch(/spam/)
  })
})

describe('lista „Bez klienta” (aplikacja)', () => {
  const roz = (o: Partial<CrmRozmowa>): CrmRozmowa => ({
    id: 'r1', ringostat_call_id: null, lead_id: null, kierunek: 'przychodzaca', odebrana: true, czas_s: 60, ivr: null, typ: 'zapytanie',
    link_nagrania: null, transkrypcja: null, podsumowanie: 'x', data_rozmowy: '2026-11-27T10:00:00Z', created_at: '2026-11-27T10:00:00Z',
    status_przetwarzania: 'przetworzona', blad: null, kategoria: null, nastepna_akcja: 'brak', analiza: null, oferta_id: null,
    numer_dzwoniacego: '+48600000001', numer_docelowy: '+48324000000', koszt_ai_usd: null, ...o,
  })
  const mail = (o: Partial<CrmMail>): CrmMail => ({
    id: 'm1', skrzynka_id: null, uid: null, message_id: null, kierunek: 'przychodzacy', od_adres: 'a@b.pl', od_nazwa: null, do_adresy: null,
    cc_adresy: null, odpowiedz_na: null, temat: 't', tresc: null, tresc_ucieta: null, zalaczniki: null, data: '2026-11-26T10:00:00Z',
    lead_id: null, oferta_id: null, typ: 'dostawca', status_przetwarzania: 'przetworzony', podsumowanie: 'y', analiza: null,
    nastepna_akcja: 'brak', koszt_ai_usd: null, zuzycie_tokenow: null, blad: null, proby: null, created_at: '2026-11-26T10:00:00Z', updated_at: null, ...o,
  })

  it('łączy rozmowy i maile od najnowszych, pomija przypięte do klienta', () => {
    const l = listaBezKlienta(
      [roz({ id: 'r1' }), roz({ id: 'r2', lead_id: 'L', data_rozmowy: '2026-11-28T10:00:00Z' })],
      [mail({ id: 'm1', data: '2026-11-28T09:00:00Z', analiza: { potencjal: 'nie', powod_braku_potencjalu: 'spam' } })],
    )
    expect(l.map((p) => `${p.rodzaj}:${p.id}`)).toEqual(['mail:m1', 'rozmowa:r1'])
    expect(l[0].potencjal).toBe('nie')
    expect(l[0].powod).toBe('spam')
  })

  it('„Do przejrzenia”: bez potencjału zawsze, dostawcy / spam / zamówienia tylko w „Wszystkie”', () => {
    expect(doPrzejrzenia({ typ: 'zapytanie', potencjal: 'nie' })).toBe(true)
    expect(doPrzejrzenia({ typ: 'dostawca', potencjal: 'nie' })).toBe(true)
    expect(doPrzejrzenia({ typ: 'inne', potencjal: null })).toBe(true)
    expect(doPrzejrzenia({ typ: 'status', potencjal: null })).toBe(true)
    for (const typ of ['dostawca', 'spam', 'newsletter', 'wlasny', 'zamowienie']) expect(doPrzejrzenia({ typ, potencjal: null })).toBe(false)
  })

  it('numer klienta z rozmowy i potencjał z analizy', () => {
    expect(numerZRozmowy({ kierunek: 'przychodzaca', numer_dzwoniacego: '+481', numer_docelowy: '+482' })).toBe('+481')
    expect(numerZRozmowy({ kierunek: 'wychodzaca', numer_dzwoniacego: '+481', numer_docelowy: '+482' })).toBe('+482')
    expect(numerZRozmowy({ kierunek: 'przychodzaca', numer_dzwoniacego: null, numer_docelowy: '+482' })).toBeNull()
    expect(potencjalApp({ potencjal: 'Nie' })).toBe('nie')
    expect(potencjalApp({})).toBeNull()
  })
})
