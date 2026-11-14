// =====================================================================
// Typy modułu „CRM Po Drzwi” — odbicie tabel schematu `crm` (migracje
// crm_podrzwi_init 13.11.2026 i 20261114_crm_superadmin_i_oferty).
// Frontend TYLKO czyta te tabele i zmienia status oferty; logika ofert
// (analiza, dobór, cena, koszyk, mail) jest w Edge Function drugiej sesji.
// =====================================================================

export type CrmLead = {
  id: string
  telefon: string | null
  email: string | null
  nazwa: string | null
  miejscowosc: string | null
  /** zewnetrzne | wewnetrzne | titan | bastion | alu | inne */
  kategoria: string | null
  /** nowy | oferta | wygrany | przegrany */
  status: string | null
  /** telefon | formularz | mail | inne */
  zrodlo: string | null
  kampania: string | null
  podsumowanie: string | null
  brakuje: string | null
  wartosc_szac: number | null
  link_oferty: string | null
  baselinker_order_id: string | null
  asana_task_gid: string | null
  nastepny_krok: string | null
  created_at: string
  updated_at: string
  // Zadanie handlowca na leadzie (brief pkt 6, 14.11.2026): zamiast Asany
  /** oddzwon | dopytaj | przygotuj_oferte | follow_up | reklamacja | null = nic do zrobienia */
  nastepna_akcja: string | null
  /** jedno zdanie, co zrobić */
  akcja_opis: string | null
  akcja_od: string | null
  ostatnia_rozmowa_at: string | null
}

export type CrmRozmowa = {
  id: string
  ringostat_call_id: string | null
  lead_id: string | null
  /** przychodzaca | wychodzaca */
  kierunek: string | null
  odebrana: boolean | null
  czas_s: number | null
  ivr: string | null
  /** zapytanie | klient | status | reklamacja | dostawca | spam | inne */
  typ: string | null
  link_nagrania: string | null
  transkrypcja: string | null
  podsumowanie: string | null
  data_rozmowy: string | null
  created_at: string
  /** pominieta | bez_ai | przetworzona | blad */
  status_przetwarzania: string | null
  blad: string | null
  kategoria: string | null
  nastepna_akcja: string | null
  analiza: Record<string, unknown> | null
  oferta_id: string | null
  numer_dzwoniacego: string | null
  numer_docelowy: string | null
  koszt_ai_usd: number | null
}

export type CrmOfertaStatus =
  | 'robocza'
  | 'do_sprawdzenia'
  | 'przelicz'
  | 'wyslana'
  | 'zaakceptowana'
  | 'odrzucona'
  | 'wygasla'

export type CrmOferta = {
  id: string
  lead_id: string | null
  rozmowa_id: string | null
  wersja: number
  poprzednia_id: string | null
  status: CrmOfertaStatus | string
  product_id: number | null
  produkt: string | null
  wybory: Record<string, unknown> | null
  zalozenia: unknown[] | null
  /** lista „SPRAWDŹ TYLKO TO” — tablica tekstów */
  sprawdz: unknown[] | null
  analiza: Record<string, unknown> | null
  dobor: Record<string, unknown> | null
  cena_bazowa: number | null
  cena_razem: number | null
  rozbicie: unknown[] | null
  koszyk_zgodny: boolean | null
  link_koszyka: string | null
  link_wazny_do: string | null
  mail_do: string | null
  mail_temat: string | null
  mail_tresc: string | null
  poprawka: string | null
  handlowiec: string | null
  sprawdzil: string | null
  wyslano_at: string | null
  zamowienie_id: number | null
  koszt_ai_usd: number | null
  created_at: string
  updated_at: string
  /** not null = funkcja crm-oferta właśnie liczy tę wersję */
  liczenie_od: string | null
  /** wynik interpretacji poprawki: {zmiany, usun, do_maila, niezrozumiane, streszczenie} */
  poprawka_wynik: Record<string, unknown> | null
  /** tekst ostatniego błędu systemu */
  uwagi: string | null
  /** osadzony lead (select `lead:leady(...)`) */
  lead?: CrmLead | null
}

/** Pozycja `rozbicie` (brief pkt 7): cena_bazowa + suma kwot = cena_razem */
export type CrmRozbiciePozycja = { grupa?: string; opcja?: string; wybor?: string; kwota?: number; typ?: string }

export const CRM_AKCJA: Record<string, { label: string; icon: string; hint: string }> = {
  oddzwon: { label: 'Oddzwoń', icon: '📞', hint: 'Nieodebrane połączenie — oddzwoń do klienta' },
  dopytaj: { label: 'Dopytaj', icon: '❓', hint: 'Brakuje danych do oferty — zapytaj klienta' },
  przygotuj_oferte: { label: 'Sprawdź i wyślij ofertę', icon: '📄', hint: 'System policzył ofertę — przeczytaj mail i wyślij' },
  follow_up: { label: 'Follow-up', icon: '🔁', hint: 'Oferta wysłana, brak odpowiedzi — przypomnij się klientowi' },
  reklamacja: { label: 'Reklamacja', icon: '⚠️', hint: 'Klient zgłasza reklamację' },
}

export const CRM_ROZMOWA_STATUS: Record<string, { label: string; cls: string }> = {
  przetworzona: { label: 'przetworzona', cls: 'crm-status--sent' },
  bez_ai: { label: 'bez analizy', cls: 'crm-status--muted' },
  pominieta: { label: 'pominięta', cls: 'crm-status--muted' },
  blad: { label: 'BŁĄD', cls: 'crm-status--lost' },
}

/** `sprawdz[0]` zaczynające się tak = błąd systemu przy liczeniu (brief pkt 7) */
export const CRM_SYSTEM_ERROR_PREFIX = 'BŁĄD systemu'
/** Follow-up po wysłaniu oferty: termin = dziś + tyle dni (pilot: ustawia frontend) */
export const CRM_FOLLOW_UP_DAYS = 3

export type CrmZdarzenie = {
  id: number
  lead_id: string | null
  oferta_id: string | null
  typ: string
  opis: string | null
  dane: Record<string, unknown> | null
  /** null = system */
  kto: string | null
  created_at: string
}

export const CRM_OFERTA_STATUS: Record<string, { label: string; cls: string }> = {
  do_sprawdzenia: { label: 'Do sprawdzenia', cls: 'crm-status--todo' },
  przelicz: { label: 'W przeliczaniu', cls: 'crm-status--working' },
  robocza: { label: 'Robocza (zastąpiona)', cls: 'crm-status--muted' },
  wyslana: { label: 'Wysłana', cls: 'crm-status--sent' },
  zaakceptowana: { label: 'Zaakceptowana', cls: 'crm-status--won' },
  odrzucona: { label: 'Odrzucona', cls: 'crm-status--lost' },
  wygasla: { label: 'Wygasła', cls: 'crm-status--muted' },
}

export const CRM_LEAD_STATUS: Record<string, string> = {
  nowy: 'Nowy',
  oferta: 'Oferta',
  wygrany: 'Wygrany',
  przegrany: 'Przegrany',
}

export const CRM_ZDARZENIE_LABEL: Record<string, string> = {
  rozmowa: 'Rozmowa',
  lead_utworzony: 'Lead utworzony',
  nieodebrana: 'Nieodebrana',
  rozmowa_pominieta: 'Rozmowa pominięta',
  analiza: 'Analiza rozmowy',
  oferta_zlecona: 'Oferta zlecona do przeliczenia',
  oferta_utworzona: 'Oferta utworzona',
  zadanie_zrobione: 'Zadanie zrobione',
  brak_kandydatow: 'Brak pasującego produktu w cenniku',
  poprawka: 'Poprawka handlowca',
  przeliczono: 'Przeliczono',
  wyslano: 'Wysłano do klienta',
  zaakceptowano: 'Klient zaakceptował',
  blad: 'Błąd',
}

/** Statusy ofert „do roboty” — domyślny filtr listy (brief pkt 3). */
export const CRM_OPEN_STATUSES = ['do_sprawdzenia', 'przelicz'] as const
