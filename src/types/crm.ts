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
  /** etykiety (brief pkt 12): slugi ze słownika crm.etykiety, posortowane przez trigger */
  etykiety?: string[] | null
}

/** Słownik etykiet crm.etykiety (brief pkt 12). Superadmin może dopisywać własne. */
export type CrmEtykieta = {
  slug: string
  nazwa: string
  /** kategoria | usluga | klient | inne */
  grupa: string
  /** blue | indigo | teal | cyan | gray | green | amber | purple | lime | red */
  kolor: string | null
  kolejnosc: number | null
  /** true = na leadzie najwyżej jedna z tej grupy (kategoria, klient) */
  jedna_na_grupe: boolean
  aktywna: boolean
}

export const CRM_ETYKIETA_GRUPA: Record<string, string> = {
  kategoria: 'Kategoria',
  usluga: 'Usługa',
  klient: 'Klient',
  inne: 'Inne',
}
export const CRM_ETYKIETA_GRUPY = ['kategoria', 'usluga', 'klient', 'inne'] as const
export const CRM_ETYKIETA_KOLORY = ['blue', 'indigo', 'teal', 'cyan', 'gray', 'green', 'amber', 'purple', 'lime', 'red'] as const

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
  /** dostawa (decyzja Tymka 14.11): 'kurier' (300 zł) | 'odbior_osobisty' (0); cena_razem = same drzwi */
  dostawa: string | null
  dostawa_koszt: number | null
  /** osadzony lead (select `lead:leady(...)`) */
  lead?: CrmLead | null
}

/** Pozycja `rozbicie` (brief pkt 7): cena_bazowa + suma kwot = cena_razem */
export type CrmRozbiciePozycja = { grupa?: string; opcja?: string; wybor?: string; kwota?: number; typ?: string }

export const CRM_AKCJA: Record<string, { label: string; icon: string; hint: string }> = {
  oddzwon: { label: 'Oddzwoń', icon: '📞', hint: 'Nieodebrane połączenie — oddzwoń do klienta' },
  dopytaj: { label: 'Dopytaj', icon: '❓', hint: 'Brakuje danych do oferty — zapytaj klienta' },
  przygotuj_oferte: { label: 'Sprawdź i wyślij ofertę', icon: '📄', hint: 'System policzył ofertę — przeczytaj mail i wyślij' },
  follow_up: { label: 'Zapytaj o decyzję', icon: '🔁', hint: 'Oferta wysłana, brak odpowiedzi — zapytaj klienta o decyzję' },
  reklamacja: { label: 'Reklamacja', icon: '⚠️', hint: 'Klient zgłasza reklamację' },
}

/** „Co zrobił system” z rozmową (brief pkt 13.4) */
export const CRM_ROZMOWA_STATUS: Record<string, { label: string; cls: string }> = {
  przetworzona: { label: 'Przeanalizowana', cls: 'crm-status--sent' },
  bez_ai: { label: 'Zapisana bez analizy', cls: 'crm-status--muted' },
  pominieta: { label: 'Pominięta', cls: 'crm-status--muted' },
  blad: { label: 'Błąd', cls: 'crm-status--lost' },
}

/**
 * KANAŁ kontaktu (brief pkt 13.1) = leady.zrodlo. W aplikacji NIE nazywać „typem”:
 * „typ” w bazie (rozmowy.typ / maile.typ) to SPRAWA (wynik analizy AI).
 */
export const CRM_KANAL: Record<string, { label: string; icon: string }> = {
  telefon: { label: 'Telefon', icon: '📞' },
  formularz: { label: 'Formularz', icon: '📝' },
  mail: { label: 'Mail', icon: '✉️' },
  wizyta: { label: 'Wizyta (walk-in)', icon: '🚪' },
  inne: { label: 'Inne', icon: '•' },
}
/** maile.kanal: mail zwykły albo zgłoszenie z formularza kontaktowego strony (Contact Form 7) */
export const CRM_MAIL_KANAL: Record<string, string> = {
  mail: 'Mail',
  formularz: 'Formularz ze strony',
}

export const CRM_DOSTAWA_LABEL: Record<string, string> = {
  kurier: 'dostawa kurierem',
  odbior_osobisty: 'odbiór osobisty',
}

/** skąd zdarzenie (dane.zrodlo) — do historii */
export const CRM_ZRODLO_LABEL: Record<string, string> = {
  ringostat: 'automatycznie, po rozmowie z Ringostatu',
  klik: 'ręcznie w aplikacji',
  cron: 'automat dzienny',
  imap: 'wykryto w poczcie',
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
  przelicz: { label: 'Liczy się', cls: 'crm-status--working' },
  robocza: { label: 'Stara wersja', cls: 'crm-status--muted' },
  wyslana: { label: 'Wysłana', cls: 'crm-status--sent' },
  zaakceptowana: { label: 'Zaakceptowana', cls: 'crm-status--won' },
  odrzucona: { label: 'Odrzucona', cls: 'crm-status--lost' },
  wygasla: { label: 'Wygasła', cls: 'crm-status--muted' },
}

/** Status klienta (brief pkt 13.6) */
export const CRM_LEAD_STATUS: Record<string, string> = {
  nowy: 'Nowy',
  oferta: 'Ma ofertę',
  wygrany: 'Zamówił',
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
  follow_up_zaplanowany: 'Follow-up zaplanowany',
  mail_wyslany: 'Mail wysłany do klienta (wykryty w poczcie)',
  klient_odpisal: 'Klient odpisał na ofertę',
  przegrany_automatycznie: 'Lead przegrany (30 dni bez aktywności)',
  brak_kandydatow: 'Brak pasującego produktu w cenniku',
  poprawka: 'Poprawka handlowca',
  przeliczono: 'Przeliczono',
  wyslano: 'Wysłano do klienta',
  zaakceptowano: 'Klient zaakceptował',
  blad: 'Błąd',
}

/**
 * Skrzynki IMAP (brief pkt 11, 14.11.2026): główna kontakt@ + osobiste pracowników (crm.skrzynki).
 * Hasła w tabeli NIE ma (vault `crm_skrzynka_<id>`); `ma_haslo` mówi tylko, czy jest zapisane.
 * Zapis wyłącznie przez rpc ustaw_skrzynke / usun_skrzynke (superadmin: wszystkie; użytkownik CRM:
 * tylko własna, user_id = auth.uid()); odczyt — każdy z dostępem do CRM.
 */
export type CrmSkrzynka = {
  id: string
  nazwa: string | null
  aktywna: boolean
  host: string | null
  port: number | null
  login: string | null
  ma_haslo: boolean
  /** właściciel skrzynki osobistej; null = wspólna */
  user_id: string | null
  /** imię do podpisu/historii */
  handlowiec: string | null
  czyta_wyslane: boolean
  folder_wyslane: string | null
  uidvalidity_wyslane: number | null
  ostatni_uid_wyslane: number | null
  czyta_odebrane: boolean
  folder_odebrane: string | null
  uidvalidity_odebrane: number | null
  ostatni_uid_odebrane: number | null
  ostatnie_sprawdzenie_at: string | null
  ostatni_sukces_at: string | null
  ostatni_blad: string | null
  ostatni_blad_at: string | null
  przetworzono_maili: number | null
  created_at: string
  updated_at: string | null
  updated_by: string | null
}

export type CrmPocztaFolder = { nazwa: string; wyslane?: boolean; odebrane?: boolean }

/** Odpowiedź crm-mail-sent na akcję test_poczty */
export type CrmPocztaTest =
  | {
      ok: true
      host?: string
      port?: number
      login?: string
      foldery?: CrmPocztaFolder[]
      folder_wyslane_podpowiedz?: string | null
      folder_odebrane_podpowiedz?: string | null
      /** = folder_wyslane_podpowiedz (zgodność wstecz) */
      folder_podpowiedz?: string | null
      folder_sprawdzony?: string | null
      maili_w_folderze?: number | null
      blad_folderu?: string | null
    }
  | { ok: false; blad?: string; dziennik?: unknown }

/** Wynik sprawdzenia jednego folderu skrzynki (akcja sprawdz_skrzynki) */
export type CrmFolderWynik = {
  folder?: string
  nowych?: number
  /** pierwsze sprawdzenie: tylko punkt startu, historia nieprzetwarzana */
  start?: boolean
  maili_w_folderze?: number
  od_uid?: number
  wyniki?: Array<{
    uid?: number
    mail_id?: string
    od?: string
    temat?: string
    status?: string
    typ?: string
    lead_id?: string | null
    oferta_id?: string | null
    zalaczniki?: number
  }>
}

export type CrmSkrzynkaWynik = {
  id: string
  nazwa?: string
  ok: boolean
  blad?: string
  pominieto?: boolean | string
  wyslane?: CrmFolderWynik
  odebrane?: CrmFolderWynik
}

export type CrmSprawdzenieSkrzynek = { ok: boolean; blad?: string; skrzynki?: CrmSkrzynkaWynik[] }

export const CRM_POCZTA_DEFAULT_PORT = 993
export const CRM_POCZTA_DEFAULT_FOLDER = 'Sent'
export const CRM_POCZTA_DEFAULT_INBOX = 'INBOX'

/** crm.maile — przychodzące (analizowane przez AI jak rozmowy) i wychodzące (dopasowane do ofert). */
export type CrmMail = {
  id: string
  skrzynka_id: string | null
  uid: number | null
  message_id: string | null
  /** przychodzacy | wychodzacy */
  kierunek: string | null
  /** mail | formularz (zgłoszenie z formularza kontaktowego strony; od_adres = klient z Reply-To) */
  kanal?: string | null
  /** techniczny nadawca przy kanal='formularz' (np. wordpress@podrzwi.pl) */
  nadawca_techniczny?: string | null
  od_adres: string | null
  od_nazwa: string | null
  do_adresy: string[] | null
  cc_adresy: string[] | null
  odpowiedz_na: string | null
  temat: string | null
  /** czysty tekst (HTML zamieniony); cytowana historia może być na końcu */
  tresc: string | null
  tresc_ucieta: boolean | null
  zalaczniki: Array<{ nazwa?: string; typ?: string; rozmiar?: number }> | null
  data: string | null
  lead_id: string | null
  oferta_id: string | null
  /** zapytanie | klient | odpowiedz | status | reklamacja | dostawca | newsletter | spam | wlasny | inne */
  typ: string | null
  /** nowy | pominiety | bez_ai | przetworzony | blad */
  status_przetwarzania: string | null
  podsumowanie: string | null
  analiza: Record<string, unknown> | null
  nastepna_akcja: string | null
  koszt_ai_usd: number | null
  zuzycie_tokenow: Record<string, unknown> | null
  blad: string | null
  proby: number | null
  created_at: string
  updated_at: string | null
  /** osadzony lead (select `lead:leady(...)`) */
  lead?: Pick<CrmLead, 'id' | 'nazwa' | 'telefon' | 'email' | 'miejscowosc'> | null
}

/** SPRAWA (czego dotyczy) = rozmowy.typ / maile.typ, wynik analizy AI (brief pkt 13.2). W UI: „Sprawa”, nigdy „Typ”. */
export const CRM_SPRAWA: Record<string, string> = {
  zapytanie: 'Nowe zapytanie',
  klient: 'Obecny klient',
  odpowiedz: 'Odpowiedź na ofertę',
  status: 'Status zamówienia',
  reklamacja: 'Reklamacja',
  dostawca: 'Dostawca / oferta dla nas',
  newsletter: 'Newsletter',
  spam: 'Spam',
  wlasny: 'Nasz mail',
  inne: 'Inne',
}
/** @deprecated nazwa historyczna — użyj CRM_SPRAWA */
export const CRM_MAIL_TYP = CRM_SPRAWA

/** „Co zrobił system” z mailem (brief pkt 13.4) */
export const CRM_MAIL_STATUS: Record<string, { label: string; cls: string }> = {
  nowy: { label: 'Czeka na analizę', cls: 'crm-status--working' },
  przetworzony: { label: 'Przeanalizowany', cls: 'crm-status--sent' },
  bez_ai: { label: 'Zapisany bez analizy', cls: 'crm-status--muted' },
  pominiety: { label: 'Pominięty', cls: 'crm-status--muted' },
  blad: { label: 'Błąd', cls: 'crm-status--lost' },
}

/** Kierunek maila (brief pkt 13.3) */
export const CRM_MAIL_KIERUNEK: Record<string, string> = {
  przychodzacy: '↙ Od klienta',
  wychodzacy: '↗ Od nas',
}

/** Statusy ofert „do roboty” — domyślny filtr listy (brief pkt 3). */
export const CRM_OPEN_STATUSES = ['do_sprawdzenia', 'przelicz'] as const
