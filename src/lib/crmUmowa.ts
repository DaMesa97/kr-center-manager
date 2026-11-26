// =====================================================================
// CRM: kiedy można przygotować umowę na montaż i co zrobić, gdy jeszcze nie.
// Umowę składa się z oferty oficjalnej z montażem, policzonej (numer, brutto,
// PDF). Przycisk „Umowa” jest zawsze widoczny — wyszarzony z podpowiedzią.
// =====================================================================
import type { CrmDokument, CrmOferta } from '../types/crm'

type OfertaDoUmowy = Pick<CrmOferta, 'rodzaj' | 'z_montazem' | 'brutto' | 'numer' | 'plik_pdf' | 'status'>

/** Statusy oferty, z których wolno zrobić umowę (zaakceptowana — np. po „Zamówił” — też). */
export const UMOWA_STATUSY_OFERTY = ['do_sprawdzenia', 'wyslana', 'zaakceptowana'] as const

const oficjalnaZMontazem = (o: OfertaDoUmowy) => o.rodzaj === 'oficjalna' && o.z_montazem !== false
const policzona = (o: OfertaDoUmowy) => o.brutto != null && Boolean(o.numer) && Boolean(o.plik_pdf)

export function ofertyDoUmowy<T extends OfertaDoUmowy>(oferty: T[]): T[] {
  return oferty.filter(
    (o) => oficjalnaZMontazem(o) && policzona(o) && (UMOWA_STATUSY_OFERTY as readonly string[]).includes(String(o.status)),
  )
}

/** Podpowiedź do wyszarzonego „Umowa” — co jeszcze zrobić na karcie klienta. null = można. */
export function umowaZablokowanaPowod(oferty: OfertaDoUmowy[]): string | null {
  if (ofertyDoUmowy(oferty).length > 0) return null
  const oficjalne = oferty.filter((o) => o.rodzaj === 'oficjalna')
  if (oficjalne.length === 0) {
    return 'Najpierw przygotuj ofertę z montażem: przycisk „Oferta z montażem” wyżej na karcie klienta. Gdy się policzy (ma numer, kwotę brutto i PDF), przycisk „Umowa” odblokuje się sam.'
  }
  const zMontazem = oficjalne.filter(oficjalnaZMontazem)
  if (zMontazem.length === 0) {
    return 'Klient ma tylko ofertę bez montażu. Umowa na montaż wymaga oferty z zaznaczonym „z montażem” — przygotuj ją przyciskiem „Oferta z montażem”.'
  }
  if (zMontazem.some((o) => !policzona(o) || o.status === 'przelicz' || o.status === 'wstrzymana')) {
    return 'Oferta z montażem jeszcze nie jest gotowa (liczy się albo nie ma numeru, kwoty brutto lub PDF). Poczekaj, aż się policzy — przycisk „Umowa” odblokuje się sam.'
  }
  return 'Oferta z montażem jest odrzucona, wygasła albo to stara wersja. Przygotuj nową ofertę przyciskiem „Oferta z montażem” — z niej zrobisz umowę.'
}

export function umowyKlienta<T extends Pick<CrmDokument, 'rodzaj' | 'status'>>(dokumenty: T[]): T[] {
  return dokumenty.filter((d) => d.rodzaj === 'umowa' && d.status !== 'anulowana')
}

export const PROTOKOL_ZABLOKOWANY = 'Protokół odbioru robi się do umowy — najpierw przygotuj umowę (przycisk „Umowa”).'
