// CRM Po Drzwi → Klienci → „Bez klienta” (zgłoszenie właściciela 28.11): rozmowy i maile przychodzące przeanalizowane
// przez AI, które NIE założyły klienta — przede wszystkim nowe kontakty „bez potencjału” (Edge crm-call-ingest,
// potencjal.ts), a w widoku „Wszystkie” też dostawcy, spam, statusy, zamówienia sklepu. Stąd „Utwórz klienta”, gdy AI się pomyliło.
import type { CrmMail, CrmRozmowa } from '../types/crm'

export const BEZ_KLIENTA_DNI = 60

export type Potencjal = 'tak' | 'nie' | 'niepewny'

export type BezKlientaPozycja = {
  rodzaj: 'rozmowa' | 'mail'
  id: string
  kiedy: string
  typ: string | null
  podsumowanie: string | null
  potencjal: Potencjal | null
  powod: string | null
  rozmowa?: CrmRozmowa
  mail?: CrmMail
}

/** sprawy, które z definicji nie są klientem — widać je tylko w „Wszystkie” (chyba że AI dało potencjał „nie”) */
const NIE_DO_PRZEJRZENIA = new Set(['dostawca', 'spam', 'newsletter', 'wlasny', 'zamowienie'])

/** potencjał z analizy AI; starsze analizy (sprzed 28.11) nie mają pola → null */
export function potencjalZAnalizy(analiza: Record<string, unknown> | null | undefined): Potencjal | null {
  const p = typeof analiza?.potencjal === 'string' ? analiza.potencjal.trim().toLowerCase() : ''
  return p === 'tak' || p === 'nie' || p === 'niepewny' ? p : null
}

export function powodZAnalizy(analiza: Record<string, unknown> | null | undefined): string | null {
  const p = typeof analiza?.powod_braku_potencjalu === 'string' ? analiza.powod_braku_potencjalu.trim() : ''
  return p || null
}

/** „Do przejrzenia”: wszystko, co AI odrzuciło jako bez potencjału, i sprawy, które mogą być klientem (zapytanie, inne…) */
export function doPrzejrzenia(p: Pick<BezKlientaPozycja, 'typ' | 'potencjal'>): boolean {
  if (p.potencjal === 'nie') return true
  return !NIE_DO_PRZEJRZENIA.has(p.typ ?? '')
}

/** rozmowy + maile w jednej liście, od najnowszych; tylko te bez klienta */
export function listaBezKlienta(rozmowy: CrmRozmowa[], maile: CrmMail[]): BezKlientaPozycja[] {
  const out: BezKlientaPozycja[] = []
  for (const r of rozmowy) {
    if (r.lead_id) continue
    out.push({
      rodzaj: 'rozmowa', id: r.id, kiedy: r.data_rozmowy ?? r.created_at, typ: r.typ, podsumowanie: r.podsumowanie,
      potencjal: potencjalZAnalizy(r.analiza), powod: powodZAnalizy(r.analiza), rozmowa: r,
    })
  }
  for (const m of maile) {
    if (m.lead_id) continue
    out.push({
      rodzaj: 'mail', id: m.id, kiedy: m.data ?? m.created_at, typ: m.typ, podsumowanie: m.podsumowanie,
      potencjal: potencjalZAnalizy(m.analiza), powod: powodZAnalizy(m.analiza), mail: m,
    })
  }
  return out.sort((a, b) => (a.kiedy < b.kiedy ? 1 : a.kiedy > b.kiedy ? -1 : 0))
}

/** numer klienta z rozmowy (jak w Edge: przychodząca — dzwoniący, wychodząca — ten, do kogo dzwoniliśmy) */
export function numerZRozmowy(r: Pick<CrmRozmowa, 'kierunek' | 'numer_dzwoniacego' | 'numer_docelowy'>): string | null {
  return (r.kierunek === 'wychodzaca' ? r.numer_docelowy : r.numer_dzwoniacego) || null
}
