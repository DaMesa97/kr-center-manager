import { CRM_WYNIK_POWOD } from '../lib/crmWynik'
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
  /** szkic odpowiedzi mailowej (brief pkt 23); null = brak. Znika sam przy zmianie zadania (trigger). */
  szkic?: CrmSzkic | null
  /** brief pkt 26: dane kontaktowe klientów połączonych w tego (rpc polacz_leady) */
  inne_kontakty?: CrmInnyKontakt[] | null
  // ---- wynik klienta (brief pkt 31, rpc oznacz_wynik) ----
  /** powód przegranej: klucz z CRM_WYNIK_POWOD (lib/crmWynik); null przy wygranym i otwartym */
  wynik_powod?: string | null
  wynik_notatka?: string | null
  /** kiedy oznaczono wynik (Zamówił / Przegrany) */
  wynik_at?: string | null
  /** kto oznaczył (auth.uid); null = automat */
  wynik_kto?: string | null
}

/** Wpis w leady.inne_kontakty po połączeniu duplikatów (brief pkt 26) */
export type CrmInnyKontakt = {
  nazwa: string | null
  email: string | null
  telefon: string | null
  miejscowosc: string | null
  zrodlo: string | null
  /** ISO — kiedy połączono */
  polaczono: string | null
}

/**
 * Duplikaty klientów (brief pkt 26). Widok `crm.duplikaty` = pary (każda raz) z powodem i pewnością:
 * ten sam telefon 100 / e-mail 95 / nazwa 85 (bez „sp. z o.o.”, kropek, diakrytyków) / domena firmowa 70 /
 * podobna nazwa 50. Rpc `duplikaty_leada(p_lead)` = to samo dla jednego klienta (baner na karcie).
 * Rpc `polacz_leady(p_cel, p_zrodlo)` — NIEODWRACALNE: historia, oferty, rozmowy, maile, dokumenty
 * źródła przechodzą na cel, kontakt źródła ląduje w `inne_kontakty`, zdarzenie `polaczono`, źródło znika.
 */
export type CrmDuplikat = {
  lead_id: string
  nazwa: string | null
  email: string | null
  telefon: string | null
  duplikat_id: string
  duplikat_nazwa: string | null
  duplikat_email: string | null
  duplikat_telefon: string | null
  powod: string
  pewnosc: number
}
export type CrmDuplikatLeada = {
  id: string
  nazwa: string | null
  email: string | null
  telefon: string | null
  miejscowosc: string | null
  status: string | null
  powod: string
  pewnosc: number
}
/** minimalny opis strony do panelu łączenia (karta klienta i Kontakty używają tego samego panelu) */
export type CrmStronaPolaczenia = { id: string; nazwa: string | null; email: string | null; telefon: string | null; miejscowosc?: string | null }

/**
 * Szkic odpowiedzi mailowej w stylu handlowca (brief pkt 23, funkcja crm-szkic). Powstaje sam przy
 * zadaniu „dopytaj” (trigger, kilkanaście–40 s) i z cronu dla follow-upów z terminem ≤ dziś, albo na
 * żądanie („Wygeneruj odpowiedź”). Nic nie jest wysyłane — handlowiec otwiera w poczcie / kopiuje.
 */
export type CrmSzkic = {
  /** dopytaj | follow_up | odpowiedz */
  rodzaj: string
  temat: string | null
  tresc: string | null
  mail_do: string | null
  /** Message-ID maila klienta, może być null */
  odpowiedz_na: string | null
  handlowiec_id: string | null
  /** imię handlowca, którego stylem pisano */
  handlowiec: string | null
  /** liczba próbek stylu (0 = bez próbek) */
  probki: number | null
  /** wlasna | wspolna | null */
  probki_zrodlo: string | null
  uwagi: string | null
  /** true = zrobił system (trigger / cron) */
  auto: boolean | null
  utworzono: string | null
  koszt_usd: number | null
  model: string | null
  /** false = funkcja napisała szkic, ale NIE zapisała go w leady.szkic (zadanie zmieniło się w trakcie); `powod` mówi czemu */
  zapisano?: boolean | null
  powod?: string | null
}
export const CRM_SZKIC_RODZAJ: Record<string, string> = {
  dopytaj: 'odpowiedź z pytaniami do klienta',
  follow_up: 'przypomnienie (follow-up)',
  odpowiedz: 'odpowiedź do klienta',
}
export type CrmSzkicOdp = { ok: boolean; lead_id: string; szkic: CrmSzkic | null; error?: string }
/** brief pkt 30: crm.oferty.mail_styl */
export type CrmMailStyl = {
  handlowiec_id: string | null
  handlowiec: string | null
  probki: number | null
  probki_zrodlo: 'wlasna' | 'wspolna' | null
  /** true = przy liczeniu oferty, false = z przycisku „Napisz w moim stylu” */
  auto: boolean | null
  utworzono: string | null
}
/** brief pkt 30: crm-szkic akcja mail_oferty — zapisano=false, gdy oferta nie jest już do_sprawdzenia (tekst tylko do skopiowania) */
export type CrmMailOfertyOdp = {
  ok: boolean
  oferta_id: string
  zapisano: boolean
  mail: { temat: string | null; tresc: string | null; handlowiec: string | null; handlowiec_id: string | null; probki: number | null; probki_zrodlo: 'wlasna' | 'wspolna' | null; koszt_usd?: number | null } | null
  error?: string
}
export const CRM_EDGE_SZKIC = 'crm-szkic'
/** crm-mail-sent akcja historia_wyslanych: import ostatnich N wysłanych maili sprzed punktu startu jako próbek stylu */
export type CrmHistoriaWyslanych = { ok: boolean; zapisano?: number; duplikaty?: number; pominieto?: number; bledy?: number; blad?: string; error?: string }
export const CRM_PROBKI_STYLU_ILE = 30
/** klucz crm.ustawienia: kogo stylem pisze system, gdy nie wie, kto prowadzi klienta (id z profiles) */
export const CRM_UST_SZKIC_HANDLOWIEC = 'szkic_domyslny_handlowiec'
/** 'true' = system sam liczy ofertę po rozmowie / mailu; inaczej oferta czeka ('wstrzymana'), aż handlowiec zaakceptuje ustalenia (16.11) */
export const CRM_UST_OFERTY_AUTO = 'oferty_automatyczne'

/**
 * Dni wolne (brief pkt 25, crm.dni_wolne): święta państwowe (`swieto`, generowane co rok przez cron
 * 2 stycznia, 2026–2031 wypełnione) i dni firmowe (`firmowe`, wpisane ręcznie). Terminy zadań je
 * omijają jak weekend (trigger leady_termin_roboczy). RLS: odczyt każdy z CRM, zapis superadmin.
 */
export type CrmDzienWolny = { data: string; nazwa: string | null; rodzaj: 'swieto' | 'firmowe' | string }
export const CRM_DZIEN_WOLNY_RODZAJ: Record<string, string> = { swieto: 'święto', firmowe: 'dzień firmowy' }

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
  /** tytuł nadany przez handlowca (21.11); null = podpowiedź z produktu / streszczenia (tytulOferty) */
  nazwa?: string | null
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
  /** mail, z którego powstała oferta (brief pkt 11); null przy rozmowie lub notatce */
  mail_id?: string | null
  /** oferta z notatki handlowca (brief pkt 15, klient z salonu): treść notatki; rozmowa_id i mail_id puste */
  notatka?: string | null
  // ---- oferta oficjalna z montażem, PDF (brief pkt 21) ----
  /** 'sklep' (link do koszyka, dotychczasowe) | 'oficjalna' (PDF, załącznik do umowy) */
  rodzaj?: 'sklep' | 'oficjalna' | string | null
  /** RRRR/MM/NNN z crm.liczniki; ten sam numer dla wszystkich wersji */
  numer?: string | null
  /** jedno zdanie z odczytu konfiguracji (crm-oferta-pdf od v8): „Dotyczy” w PDF i §1 umowy; starsze oferty null */
  streszczenie?: string | null
  producent?: string | null
  /** ścieżka pliku z konfiguratora w buckecie crm-dokumenty (= pierwszy z konfiguracja_pliki) */
  konfiguracja_plik?: string | null
  /** brief pkt 29 (#160): wszystkie pliki konfiguracji tej oferty (maks. 10); stare oferty uzupełnione z konfiguracja_plik */
  konfiguracja_pliki?: string[] | null
  /** brief pkt 30 (#159): czyim stylem napisano mail oferty; null przy starych ofertach */
  mail_styl?: CrmMailStyl | null
  konfiguracja_tekst?: string | null
  pozycje?: CrmOfertaPozycja[] | null
  uslugi?: CrmUsluga[] | null
  zakres?: string | null
  z_montazem?: boolean | null
  lokal_mieszkalny?: boolean | null
  /** mieszkanie | dom | uzytkowy */
  rodzaj_lokalu?: string | null
  powierzchnia_m2?: number | null
  netto?: number | null
  /** '23%' | '8%' | '8% / 23%' */
  vat_stawka?: string | null
  vat_kwota?: number | null
  brutto?: number | null
  vat_uwaga?: string | null
  /** ścieżka PDF w buckecie crm-dokumenty (pobieranie przez signed URL) */
  plik_pdf?: string | null
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
  pomiar: { label: 'Pomiar', icon: '📐', hint: 'Umówiony pomiar u klienta' },
  montaz: { label: 'Montaż', icon: '🔧', hint: 'Umówiony montaż u klienta' },
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
  wstrzymana: { label: 'Czeka na akceptację', cls: 'crm-status--todo' },
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
  lead_utworzony: 'Nowy klient',
  nieodebrana: 'Nieodebrana',
  rozmowa_pominieta: 'Rozmowa pominięta',
  analiza: 'Analiza rozmowy',
  oferta_zlecona: 'Oferta zlecona do przeliczenia',
  oferta_utworzona: 'Oferta utworzona',
  zadanie_zrobione: 'Zadanie zrobione',
  zadanie_usuniete: 'Zadanie usunięte',
  zadanie_zmienione: 'Zadanie zmienione',
  polaczono: 'Połączono klientów',
  follow_up_zaplanowany: 'Follow-up zaplanowany',
  mail_wyslany: 'Mail wysłany do klienta',
  klient_odpisal: 'Klient odpisał na ofertę',
  przegrany_automatycznie: 'Lead przegrany (30 dni bez aktywności)',
  wygrany: 'Zamówił',
  przegrany: 'Przegrany',
  przywrocony: 'Przywrócono do gry',
  wartosc_zmieniona: 'Zmieniono wartość klienta',
  oferta_nazwa: 'Tytuł oferty',
  brak_kandydatow: 'Brak pasującego produktu w cenniku',
  poprawka: 'Poprawka handlowca',
  przeliczono: 'Przeliczono',
  wyslano: 'Wysłano do klienta',
  zaakceptowano: 'Klient zaakceptował',
  blad: 'Błąd',
  dokument: 'Dokument',
  szkic: 'Szkic odpowiedzi',
  dopasowano: 'Dopisano do istniejącego klienta',
}

/**
 * Etykieta zdarzenia zależna od `dane.zrodlo` (zgłoszenie 15.11): `mail_wyslany` z `klik` to checkbox
 * „wysłałem ofertę poza systemem” w dialogu „Zrobione, co dalej” (rpc zamknij_zadanie), nie wykrycie
 * maila w poczcie — bez słowa „mail”, żeby nie wyglądało na automat.
 */
export function zdarzenieLabel(typ: string, dane: Record<string, unknown> | null | undefined): string {
  const zrodlo = typeof dane?.zrodlo === 'string' ? dane.zrodlo : null
  if (typ === 'mail_wyslany') {
    if (zrodlo === 'klik') return 'Oznaczono: oferta wysłana poza systemem'
    if (zrodlo === 'imap') return 'Mail wysłany do klienta (wykryty w poczcie)'
  }
  // brief pkt 22: zdarzenie `dokument` z dane.rodzaj / dane.numer
  // brief pkt 27: mail od nowego adresu dopisany do klienta po domenie firmowej / adresie z połączonego kontaktu
  if (typ === 'dopasowano') {
    const powod = dane?.powod === 'domena' ? 'ta sama domena firmowa' : dane?.powod === 'inne_kontakty' ? 'adres z połączonego kontaktu' : null
    return `🔗 Dopisano do klienta${powod ? ` (${powod})` : ''}`
  }
  if (typ === 'dokument') {
    const rodzaj = typeof dane?.rodzaj === 'string' ? CRM_DOKUMENT_RODZAJ[dane.rodzaj]?.label ?? dane.rodzaj : 'Dokument'
    const numer = typeof dane?.numer === 'string' && dane.numer ? ` nr ${dane.numer}` : ''
    return `📄 ${rodzaj}${numer}`
  }
  // brief pkt 23: zdarzenie `szkic` z dane.rodzaj / dane.auto
  if (typ === 'szkic') {
    const rodzaj = typeof dane?.rodzaj === 'string' ? CRM_SZKIC_RODZAJ[dane.rodzaj] : null
    return `✍️ Szkic odpowiedzi${rodzaj ? `: ${rodzaj}` : ''}${dane?.auto === true ? ' (automatycznie)' : ''}`
  }
  // brief pkt 31: wynik klienta z powodem przegranej
  if (typ === 'przegrany') {
    const p = typeof dane?.powod === 'string' ? CRM_WYNIK_POWOD[dane.powod] ?? dane.powod : null
    return `✖ Przegrany${p ? `: ${p}` : ''}${typeof dane?.notatka === 'string' && dane.notatka ? ` — ${dane.notatka}` : ''}`
  }
  if (typ === 'wygrany') return '✔ Zamówił'
  // przywrócenie: ręcznie albo samo (klient zadzwonił / napisał / wysłano ofertę), z poprzednim powodem
  if (typ === 'przywrocony') {
    const skad = typeof dane?.zrodlo === 'string' && dane.zrodlo ? dane.zrodlo : null
    const pop = typeof dane?.poprzedni_powod === 'string' && dane.poprzedni_powod ? CRM_WYNIK_POWOD[dane.poprzedni_powod] ?? dane.poprzedni_powod : null
    return `↺ Przywrócono do gry${skad ? ` (${skad})` : ''}${pop ? ` · wcześniej: ${pop}` : ''}`
  }
  if (typ === 'przegrany_automatycznie' && typeof dane?.powod === 'string') {
    return `✖ Przegrany automatycznie: ${CRM_WYNIK_POWOD[dane.powod] ?? dane.powod} (30 dni bez kontaktu)`
  }
  return CRM_ZDARZENIE_LABEL[typ] ?? typ
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
  /** brief pkt 24: „Nowe zamówienie NNN” ze sklepu — bez adnotacji klienta bez leada i zadania (Baselinker), z nietypową adnotacją lead + oddzwon */
  zamowienie: 'Zamówienie sklepowe',
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

/** Strony pomocy CRM (crm.pomoc, 14.11.2026): instrukcja pracy w markdown, edytowalna przez superadmina bez nowej wersji aplikacji. */
export type CrmPomocStrona = {
  slug: string
  tytul: string
  tresc_md: string | null
  kolejnosc: number | null
  updated_at: string | null
  updated_by: string | null
}

/** Zasady domyślne ofert (crm.zasady, brief pkt 16): jedno zdanie = jedna zasada, idzie wprost do promptów AI. */
export type CrmZasada = {
  id: string
  /** dobor = dobór produktu, mail = treść maila */
  grupa: 'dobor' | 'mail' | string
  tresc: string
  aktywna: boolean
  kolejnosc: number
  updated_by: string | null
  created_at: string
  updated_at: string
}
export const CRM_ZASADA_GRUPA: Record<string, { label: string; hint: string }> = {
  dobor: { label: 'Dobór produktu', hint: 'Co system przyjmuje, gdy klient czegoś nie ustalił (kolor, rozmiar, okucia…). Trafia do „Przyjęte domyślnie” w ofercie, nie na listę „sprawdź tylko to”.' },
  mail: { label: 'Treść maila', hint: 'Jak system pisze mail do klienta (czego nie podawać, jak informować o założeniach).' },
}

/** Ustawienia CRM (crm.ustawienia: klucz/wartość, brief pkt 16) — dziś alerty o błędach systemu. */
export type CrmUstawienie = { klucz: string; wartosc: string | null; opis: string | null; updated_at: string | null }
export const CRM_ALERT_KEYS = {
  email: 'alert_email',
  port: 'alert_smtp_port',
  skrzynka: 'alert_skrzynka_id',
  ostatniAt: 'alert_ostatni_at',
  ostatniBlad: 'alert_ostatni_blad',
  ostatnieZdarzenie: 'alert_ostatnie_zdarzenie_id',
} as const
/** odpowiedź crm-mail-sent akcja test_alertu: {ok:true, wyslano_do, temat, smtp} albo {ok:false, blad} (nie-superadmin też dostaje blad) */
export type CrmAlertTest = { ok: boolean; wyslano_do?: string[] | string; temat?: string; smtp?: string; blad?: string }

/** Wiersz widoku crm.poprawki_ostatnie (30 dni, brief pkt 17): co handlowiec poprawia w ofertach. */
export type CrmPoprawkaRow = {
  created_at: string
  klient: string | null
  telefon: string | null
  wersja: number | null
  poprawka: string | null
  streszczenie: string | null
  zmiany: unknown
  usuniete: unknown
  do_maila: string | null
  niezrozumiane: unknown
  handlowiec: string | null
  oferta_id: string | null
  lead_id: string | null
}

/** Nagranie notatki głosowej (brief pkt 18): bucket crm-nagrania, maks. 3 min, webm/opus. */
export const CRM_NAGRANIE_BUCKET = 'crm-nagrania'
export const CRM_NAGRANIE_MAX_S = 180

/**
 * Pozycja oferty: oficjalna (przepisana z konfiguracji producenta, brief pkt 21: nazwa/jm/netto_szt/netto)
 * albo sklepowa (brief pkt 28, crm-oferta v12: produkt/wybory/cena_bazowa/cena_szt/cena_razem/rozbicie).
 * Oferty sklepowe sprzed 16.11 mają `pozycje = null` → jedna pozycja z product_id/wybory oferty.
 */
export type CrmOfertaPozycja = {
  lp?: number
  nazwa?: string
  opis?: string
  ilosc?: number
  jm?: string
  netto_szt?: number
  netto?: number
  brutto_szt_z_pliku?: number
  // sklep (pkt 28)
  product_id?: number | string | null
  produkt?: string
  wybory?: Record<string, unknown> | null
  cena_bazowa?: number | string | null
  cena_szt?: number | string | null
  cena_razem?: number | string | null
  rozbicie?: CrmRozbiciePozycja[] | null
}
/** Usługa własna w ofercie oficjalnej: nazwa + kwota netto, bez stałych stawek. */
export type CrmUsluga = { nazwa: string; netto: number }

export const CRM_OFERTA_RODZAJ: Record<string, { label: string; title: string }> = {
  sklep: { label: 'Sklep', title: 'Oferta ze sklepu: cena z kalkulatora, link do koszyka' },
  oficjalna: { label: 'PDF', title: 'Oferta oficjalna z montażem (PDF, załącznik do umowy)' },
}
export const CRM_RODZAJ_LOKALU: Record<string, string> = { mieszkanie: 'Mieszkanie', dom: 'Dom', uzytkowy: 'Lokal użytkowy' }
export const CRM_PRODUCENCI = ['KR Center', 'DRE', 'inny'] as const
export const CRM_USLUGI_PODPOWIEDZI = ['Montaż', 'Demontaż i utylizacja', 'Dostawa i wniesienie', 'Pomiar', 'Obróbka murarska'] as const
export const CRM_ZAKRES_PODPOWIEDZI = [
  'Towar z montażem — dostawa, pomiar i wniesienie wliczone',
  'Towar z demontażem starej stolarki i montażem — bez obróbki murarskiej',
] as const
export const CRM_DOKUMENTY_BUCKET = 'crm-dokumenty'
export const CRM_LOGO_PATH = 'szablon/logo.png'
/** klucze crm.ustawienia do stopki PDF i reguł VAT (Ustawienia → Dane firmy) */
export const CRM_FIRMA_KEYS: Array<{ klucz: string; label: string }> = [
  { klucz: 'firma_nazwa', label: 'Nazwa firmy' },
  { klucz: 'firma_adres', label: 'Siedziba' },
  { klucz: 'firma_salon', label: 'Salon' },
  { klucz: 'firma_tel', label: 'Telefon' },
  { klucz: 'firma_email', label: 'E-mail' },
  { klucz: 'firma_www', label: 'Strona' },
  { klucz: 'firma_nip', label: 'NIP' },
  { klucz: 'firma_regon', label: 'REGON' },
  { klucz: 'firma_krs', label: 'KRS' },
  { klucz: 'firma_kapital', label: 'Kapitał zakładowy' },
]
export type CrmLicznik = { klucz: string; wartosc: number; updated_at: string | null }

/** etykieta licznika w Ustawieniach → Dane firmy: `oferta:2026` → „Oferty 2026” */
export function licznikLabel(klucz: string): string {
  const [typ, rok] = klucz.split(':')
  const nazwy: Record<string, string> = { oferta: 'Oferty', umowa: 'Umowy' }
  return `${nazwy[typ] ?? typ} ${rok ?? ''}`.trim()
}

// ---- Dokumenty klienta (brief pkt 22): karta pomiarowa, umowa, protokół — Edge Function crm-dokumenty ----
export type CrmDokument = {
  id: string
  lead_id: string
  oferta_id: string | null
  /** karta_pomiarowa | umowa | protokol */
  rodzaj: string
  /** umowa i protokół: NN/MM/RRRR; karta: null */
  numer: string | null
  /** migawka pól użytych w PDF (do „Generuj ponownie” i podglądu) */
  dane: Record<string, unknown>
  plik_pdf: string | null
  /** blankiet | projekt | wyslana | podpisana | anulowana — aplikacja zmienia TYLKO status */
  status: string
  utworzyl: string | null
  created_at: string
  updated_at: string
}

export const CRM_DOKUMENT_RODZAJ: Record<string, { label: string; title: string }> = {
  karta_pomiarowa: { label: 'Karta pomiarowa', title: 'Blankiet na pomiar (A4 poziomo), wypełniany długopisem' },
  umowa: { label: 'Umowa', title: 'Umowa z oferty oficjalnej z montażem; załącznik = PDF oferty' },
  protokol: { label: 'Protokół odbioru', title: 'Protokół odbioru do umowy, z rozliczeniem' },
}

export const CRM_DOKUMENT_STATUS: Record<string, { label: string; cls: string }> = {
  blankiet: { label: 'Blankiet', cls: 'crm-status--muted' },
  projekt: { label: 'Projekt', cls: 'crm-status--todo' },
  wyslana: { label: 'Wysłana', cls: 'crm-status--sent' },
  podpisana: { label: 'Podpisana', cls: 'crm-status--won' },
  anulowana: { label: 'Anulowana', cls: 'crm-status--lost' },
}

export const CRM_OTWOR_RODZAJ = ['wewnętrzne', 'zewnętrzne', 'wejściowe'] as const
/** karta pomiarowa ma zawsze 10 wierszy w tabeli — tyle można wpisać z góry */
export const CRM_KARTA_OTWORY_MAX = 10

/** odpowiedź crm-dokumenty: `url` = podpisany link 10 min do PDF */
export type CrmDokumentOdp = { ok: boolean; dokument_id: string; rodzaj: string; numer: string | null; plik_pdf: string; url: string }

export const CRM_EDGE_DOKUMENTY = 'crm-dokumenty'

/** „Zrobione” z następnym krokiem (rpc crm.zamknij_zadanie, brief pkt 20) */
/** `termin` (RRRR-MM-DD) = konkretna data z kalendarza (Tymek 16.11); gdy jest, `za_dni` to tylko jej przeliczenie na dziś */
export type CrmZamknijZadanie = { nastepna_akcja: string | null; za_dni: number; opis: string | null; wyslano_oferte: boolean; termin?: string | null }

/** Statusy ofert „do roboty” — domyślny filtr listy (brief pkt 3). */
export const CRM_OPEN_STATUSES = ['do_sprawdzenia', 'przelicz', 'wstrzymana'] as const
