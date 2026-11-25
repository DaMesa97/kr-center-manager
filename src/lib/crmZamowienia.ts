// CRM Po Drzwi → Zamówienia (#144/#153): status produkcji zamówienia sklepu złożony z jego zleceń KR Center
// i lista „wymaga uwagi”. Czyste funkcje — dane ładuje useCrm (fetchZamowieniaPanel), ekran CrmZamowieniaScreen.
import type { Order } from '../types'
import { countCompletedStages, parseOrderExtraFields } from '../utils'

export type ZamowienieSklep = {
  bl_id: number
  shop_order_id: string | null
  status_id: number | null
  potwierdzone: boolean
  data_zlozenia: string | null
  data_potwierdzenia: string | null
  data_statusu: string | null
  klient: string | null
  firma: string | null
  email: string | null
  telefon: string | null
  adres: string | null
  kod: string | null
  miasto: string | null
  dostawa_metoda: string | null
  dostawa_cena: number | null
  paczka_nr: string | null
  punkt_odbioru: string | null
  platnosc_metoda: string | null
  pobranie: boolean
  oplacone: number | null
  kwota: number | null
  waluta: string | null
  pozycje: Array<{ nazwa: string; atrybuty: string | null; sku: string | null; ilosc: number; cena: number }>
  uwagi_klienta: string | null
  uwagi_sklepu: string | null
  pola_dodatkowe: Record<string, unknown>
  strona_klienta: string | null
  lead_id: string | null
  synced_at: string
}

export type BlStatus = { id: number; nazwa: string; nazwa_klient: string | null; kolor: string | null; kolejnosc: number | null }
export type Powiazanie = { bl_id: number; order_id: number; powiazanie: 'auto' | 'reczne' }
export type ReklamacjaKr = {
  id: number
  complaint_number: string | null
  complaint_date: string | null
  order_id: number | null
  category: string | null
  what_complained: string | null
  reason: string | null
  release_date: string | null
}

/** Stan jednego zlecenia KR z punktu widzenia sklepu. */
export type StanZlecenia = 'anulowane' | 'wyslane' | 'gotowe' | 'prod'
/** Status produkcji zamówienia sklepu (jedno słowo na liście). */
export type StanZamowienia = 'brak' | 'bez_produkcji' | 'prod' | 'czesc' | 'gotowe' | 'wyslane' | 'reklamacja' | 'anulowane'

export const STAN_ZAMOWIENIA: Record<StanZamowienia, { label: string; cls: string; title: string }> = {
  brak: { label: 'Brak zlecenia', cls: 'crm-status--todo', title: 'Drzwi w zamówieniu, a w KR Center nie ma jeszcze zlecenia' },
  bez_produkcji: { label: 'Bez produkcji', cls: 'crm-status--muted', title: 'Zamówienie bez zlecenia KR (akcesoria albo jeszcze nie wysłane na produkcję)' },
  prod: { label: 'W produkcji', cls: 'crm-status--working', title: 'Zlecenia KR w toku' },
  czesc: { label: 'Częściowo gotowe', cls: 'crm-status--todo', title: 'Część zleceń gotowa, część jeszcze w produkcji' },
  gotowe: { label: 'Gotowe', cls: 'crm-status--sent', title: 'Wszystkie zlecenia wydane z produkcji, czekają na wyjazd' },
  wyslane: { label: 'Wysłane', cls: 'crm-status--won', title: 'Wszystkie zlecenia wyjechały (biurko logistyki)' },
  reklamacja: { label: 'Reklamacja', cls: 'crm-status--lost', title: 'Jest otwarte zlecenie naprawcze do któregoś ze zleceń' },
  anulowane: { label: 'Anulowane', cls: 'crm-status--muted', title: 'Zlecenia KR anulowane' },
}

export const DOBA_MS = 24 * 3600_000

export function stanZlecenia(o: Order): StanZlecenia {
  if (parseOrderExtraFields(o.extra_fields).cancelled) return 'anulowane'
  if (o.shipped_at) return 'wyslane'
  if (o.release_date) return 'gotowe'
  const c = countCompletedStages(o)
  return c.total > 0 && c.completed >= c.total ? 'gotowe' : 'prod'
}

const ANUL_RE = /anul/i
const DRZWI_RE = /drzwi|skrzyd[łl]o|o[śs]cie[żz]nic/i

export function maDrzwi(z: Pick<ZamowienieSklep, 'pozycje'>): boolean {
  return (z.pozycje ?? []).some((p) => DRZWI_RE.test(p.nazwa ?? ''))
}

export function oplacone(z: Pick<ZamowienieSklep, 'oplacone' | 'kwota' | 'pobranie'>): boolean {
  if (z.pobranie) return true
  const k = Number(z.kwota ?? 0)
  return k > 0 && Number(z.oplacone ?? 0) >= k - 0.5
}

export function stanZamowienia(z: ZamowienieSklep, zlecenia: Order[], reklamacjeOtwarte: number, statusNazwa: string | null): StanZamowienia {
  const aktywne = zlecenia.filter((o) => stanZlecenia(o) !== 'anulowane')
  if (zlecenia.length > 0 && aktywne.length === 0) return 'anulowane'
  if (aktywne.length === 0) {
    if (statusNazwa && ANUL_RE.test(statusNazwa)) return 'anulowane'
    return maDrzwi(z) ? 'brak' : 'bez_produkcji'
  }
  if (reklamacjeOtwarte > 0) return 'reklamacja'
  const stany = aktywne.map(stanZlecenia)
  if (stany.every((s) => s === 'wyslane')) return 'wyslane'
  if (stany.every((s) => s === 'wyslane' || s === 'gotowe')) return 'gotowe'
  if (stany.some((s) => s === 'wyslane' || s === 'gotowe')) return 'czesc'
  return 'prod'
}

/** Powody, dla których zamówienie trafia do paska „wymaga uwagi” (pusta lista = w porządku). */
export function uwagiZamowienia(
  z: ZamowienieSklep,
  zlecenia: Order[],
  stan: StanZamowienia,
  statusNazwa: string | null,
  teraz: number = Date.now(),
): string[] {
  const out: string[] = []
  const anulowaneWSklepie = !!statusNazwa && ANUL_RE.test(statusNazwa)
  if (stan === 'brak' && !anulowaneWSklepie && oplacone(z)) {
    const od = Date.parse(z.data_potwierdzenia ?? z.data_zlozenia ?? '')
    if (Number.isFinite(od) && teraz - od > DOBA_MS) {
      out.push(`opłacone ${Math.round((teraz - od) / 3600_000)} h temu, nie ma zlecenia w KR Center`)
    }
  }
  if ((stan === 'gotowe' || stan === 'wyslane') && statusNazwa && /produkcj/i.test(statusNazwa)) {
    out.push(`${stan === 'wyslane' ? 'wyjechało' : 'gotowe'}, a w sklepie nadal „${statusNazwa}”`)
  }
  if (anulowaneWSklepie) {
    const otwarte = zlecenia.filter((o) => { const s = stanZlecenia(o); return s === 'prod' || s === 'gotowe' })
    if (otwarte.length > 0) out.push(`anulowane w sklepie, a zlecenie KR ${otwarte.map((o) => `${o.category} ${o.order_number}`).join(', ')} dalej otwarte`)
  }
  return out
}

/** Krótki termin / stan wyjazdu do kolumny „Termin”. */
export function terminZamowienia(zlecenia: Order[]): string {
  const aktywne = zlecenia.filter((o) => stanZlecenia(o) !== 'anulowane')
  if (aktywne.length === 0) return '—'
  const fmt = (d: string | null | undefined) => {
    if (!d) return ''
    const t = new Date(d)
    return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
  }
  const wyslane = aktywne.filter((o) => o.shipped_at)
  if (wyslane.length === aktywne.length) {
    const o = wyslane[wyslane.length - 1]
    return `wyjechało ${fmt(o.shipped_at)}${o.shipped_route ? ` (${o.shipped_route})` : ''}`
  }
  const gotowe = aktywne.filter((o) => o.release_date && !o.shipped_at)
  if (gotowe.length + wyslane.length === aktywne.length) {
    const trasa = gotowe.map((o) => o.shipped_route).find(Boolean)
    return `na magazynie od ${fmt(gotowe[gotowe.length - 1].release_date)}${trasa ? `, trasa ${trasa}` : ''}`
  }
  const dni = [...new Set(aktywne.filter((o) => !o.release_date).map((o) => (o.production_day ?? '').trim()).filter(Boolean))]
  return dni.length ? `produkcja: ${dni.join(', ')}` : 'w produkcji'
}

/** Kandydaci do ręcznego powiązania: nazwisko z nr zamówienia klienta zlecenia w nazwie klienta zamówienia BL. */
export function slowaNazwiska(tekst: string | null | undefined): string[] {
  return (tekst ?? '')
    .toUpperCase()
    .replace(/^OF\//, '')
    .split(/[^A-ZĄĆĘŁŃÓŚŹŻ]+/)
    .filter((w) => w.length >= 4 && !['DRZWI', 'PODRZWI'].includes(w))
}

export function pasujeDoKlienta(z: Pick<ZamowienieSklep, 'klient' | 'firma' | 'email'>, slowa: string[]): boolean {
  if (slowa.length === 0) return false
  const hay = [z.klient, z.firma, z.email].filter(Boolean).join(' ').toUpperCase()
  return slowa.some((w) => hay.includes(w))
}

export const BL_PANEL_URL = (blId: number) => `https://panel-f.baselinker.com/orders.php#order:${blId}`
