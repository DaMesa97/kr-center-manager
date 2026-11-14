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
  /** osadzony lead (select `lead:leady(...)`) */
  lead?: CrmLead | null
}

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
  przelicz: { label: 'Przeliczanie…', cls: 'crm-status--working' },
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
  analiza: 'Analiza rozmowy',
  oferta_utworzona: 'Oferta utworzona',
  poprawka: 'Poprawka handlowca',
  przeliczono: 'Przeliczono',
  wyslano: 'Wysłano do klienta',
  zaakceptowano: 'Klient zaakceptował',
  blad: 'Błąd',
}

/** Statusy ofert „do roboty” — domyślny filtr listy (brief pkt 3). */
export const CRM_OPEN_STATUSES = ['do_sprawdzenia', 'przelicz'] as const
