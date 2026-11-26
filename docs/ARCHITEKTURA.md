# KR Center Manager — Architektura i przewodnik wdrożeniowy

> Dokument dla osoby technicznej / administratora systemu. Opisuje jak system jest
> zbudowany, którędy płyną dane i — przede wszystkim — **jak wdrażać nowe modele,
> kolory, systemy, okucia itd.** (sekcja „Runbooki").
>
> Instrukcja dla użytkowników końcowych: zakładka **Pomoc** w aplikacji.

---

## 1. Stack i komponenty

| Warstwa | Technologia |
|---|---|
| Aplikacja desktop | Electron 30 (Windows), auto-update z GitHub Releases |
| Frontend | React 18 + TypeScript + Vite 5 |
| Backend | Supabase: Postgres + Auth + Edge Functions + Realtime + Storage |
| Wersja mobilna | Ta sama baza, osobny build webowy (`vite.mobile.config.ts`, `src/MobileApp.tsx`) |
| Monitoring | Sentry (renderer + main process) |
| Dystrybucja | electron-builder (NSIS) → GitHub Releases `DaMesa97/kr-center-manager` |

Struktura kodu (najważniejsze):

```
src/App.tsx                 – główny komponent (stan, zakładki, spinanie hooków)
src/hooks/useOrders.ts      – logika zleceń (CRUD, etapy, rekordy łączone)
src/hooks/useWarehouse.ts   – magazyn (stany, PZ/MM, receptury, ROP, rezerwacje)
src/hooks/useMyStation.ts   – „Moje stanowisko" (oznaczanie etapów + wydania)
src/hooks/useStockPreview.ts– podgląd braków przed zapisem zlecenia
src/hooks/useConfig.ts      – słowniki konfiguracji
src/hooks/useAuth.ts        – logowanie, sesja, profil
src/lib/permissions.ts      – RBAC: role + macierz uprawnień (can/isManagerRole)
src/lib/labelRender.ts      – render etykiet HTML + pola {{...}}
src/lib/dopMatch.ts         – dobór dokumentów DoP/DWU do zlecenia
src/lib/stationLogic.ts     – logika „Moje stanowisko" (blokady etapów, zadania)
src/constants.ts            – definicje etapów, słowników, zakładek, formularzy
src/utils.ts                – funkcje pomocnicze (widoczność zakładek, parsowanie)
src/components/*            – widoki (m.in. 4 tabele zleceń per kategoria)
src/components/warehouse/*  – widoki magazynu (Stany, Rezerwacje, W drodze,
                              Ruchy, Inwentaryzacja, Receptury, ZD…)
electron/main.ts            – proces główny: okno, auto-update, druk (IPC)
supabase/functions/*        – Edge Functions (kopie robocze; deploy ręczny)
migrate/*.sql               – migracje/utility SQL (odpalane ręcznie w SQL Editor)
docs/                       – ten dokument + INSTRUKCJA.md
```

---

## 2. Przepływ danych (mapa systemu)

```
                    ┌────────────────────┐
  KONFIGURATOR ───► │ Edge: orders-intake│──► RPC create_bot_order ──┐
  (klient online)   └────────────────────┘    (mapowanie pól,        │
                                              needs_review, dedup    │
                                              po recordId)           ▼
                    ┌──────────────────────────┐              ┌────────────┐
  EXCEL (formularz) │ Edge: orders-excel-intake│─────────────►│   orders   │
  ręczne + bot ───► │ („dynamic-handler")      │  dedup po    │  (Postgres)│
                    └──────────────────────────┘  (kategoria+ └─────┬──────┘
                                                   numer)           │
  APLIKACJA (formularz "Nowe zamówienie") ──────────────────────────┤
                                                                    │
        po INSERT: auto-tworzenie rekordów łączonych                │
        (Disting Plus para, Titan trójka) + REZERWACJA              │
        komponentów wg receptur (stan fizyczny bez zmian)           │
                                                                    ▼
   ETAPY PRODUKCJI (inicjały w production_stages JSON)  ◄── pracownicy
        │ mirror etapów między rekordami łączonymi (RPC update_order_stage)
        │ oznaczenie etapu = WYDANIE FIZYCZNE (WZ) komponentów
        │ przypiętych do tego etapu (release_stock_for_stage)
        ▼
   WYDANIE (release_date per kategoria, niezależnie) ──► Wysyłka ──► Archiwum
        │ przy wydaniu: catch-all WZ resztek rezerwacji     (orders_archive)
        ▼ (release_remaining_for_order)
   MAGAZYN: stany/rezerwacje/ruchy ◄── PZ/MM/inwentaryzacja/zniszczenia
```

**Realtime**: zmiany w `orders` są nasłuchiwane (Supabase Realtime) — inni użytkownicy
widzą etapy/zmiany bez odświeżania.

**Docelowy kierunek** (w trakcie migracji): Excel znika; ręczne zlecenia wpisywane w
aplikacji, automatyczne wyłącznie przez `orders-intake` (konfigurator).

---

## 3. Baza danych — najważniejsze tabele

| Tabela | Co trzyma |
|---|---|
| `orders` | Wszystkie zlecenia, wszystkie kategorie. Kolumny wspólne + specyficzne `bastion_*` (kolekcja, ościeżnica, zakres, panele boczne/górne, priorytet…). `production_stages` = JSON etapów (wartość = inicjały wykonawcy). `extra_fields` = JSON (wykonawca, titan_group, cancelled, raw_payload z bota…). `linked_order_id` = powiązanie par. `source` = `null`/ręczne, `bot`, `excel`. |
| `orders_archive` | Zrealizowane, przeniesione przez `archive_old_orders`. |
| `profiles` | Konta: rola, inicjały, kategorie (`categories text[]`). |
| `worker_stages` | Przypisania etapów do pracowników (kto co oznacza w „Moje stanowisko"). |
| `config_options` | **Słowniki formularzy**: `(category, type, value, sort_order)` — systemy, modele, kolory, okucia… Patrz runbooki. |
| `config_exclusions` | Wykluczenia niedozwolonych kombinacji pól. |
| `dimension_map` | Mapowanie wymiarów (szer/wys → wymiary produkcyjne, poszerzenia). |
| `lead_time_rules` | Czasy realizacji (terminy ostrzeżeń/zaległości). |
| `companies` | Kontrahenci: dni produkcji/tras. |
| `company_aliases` | Zapamiętane dopasowania nazw → kontrahent. Od 20.11 trigger `trg_apply_company_alias` działa przy KAŻDYM INSERT do orders (bot, Excel, API, ręcznie): 1) alias po kluczu `company_key()` (`alias_key`), 2) bez aliasu kontrahent z `companies` o tym samym kluczu (`name_key`) → jego pisownia; oryginał w `extra_fields.company_as_received` (`migrate/firmy_alias_wszystkie_zrodla.sql`). Od 20.11 też statystyki: Statystyki → Firmy → „Porządek nazw firm” (kierownik scala pisownie; `lib/companyStats.ts`: companyKey skleja sam wielkość liter/ogonki/„#”/powtórzone słowo, aliasy resztę; rekordy łączone Titan/Disting Plus liczone raz — isLinkedSecondary). |
| `warehouse_components` / `warehouse_stock` / `warehouse_movements` | Kartoteka, stany per magazyn, ruchy. `warehouse_stock` ma `reserved_quantity` + `available_quantity` (kolumna GENERATED: fizyczny − zarezerwowane) oraz `min_quantity` (minimum półki, null = nie pilnujemy; §6a). Typy ruchów: `PZ`/`WZ`/`MM`/`ZWR`/`INW`/`ZN` (+ legacy `in`/`out`); ruchy grupowane w dokumenty po `reference`. |
| `stock_reservations` | Rezerwacje komponentów per zlecenie (model dwustopniowy — sekcja 6). |
| `warehouse_recipes` / `warehouse_recipe_components` / `warehouse_recipe_criteria` | Receptury — co schodzi na zlecenie. Dobór po **dynamicznych kryteriach** (dowolne pole zlecenia + dozwolone wartości; wygrywa najbardziej szczegółowa). Pozycja komponentu ma `stage_key` = etap wydania. |
| `warehouses` | Definicje magazynów (Bukowa, Marklowicka, Wewnętrzne #1/#2). |
| `inventory_sessions` / `inventory_lines` | Sesje inwentaryzacji per magazyn (spis ślepy, korekta ruchem `INW`). |
| `damage_reports` | Zgłoszenia zniszczeń / drugiego gatunku (ruch `ZN`). |
| `purchase_orders` / `purchase_order_items` | Zamówienia do dostawców. `suppliers` — dostawcy. |
| `label_templates` | Szablony etykiet HTML per kategoria (pola `{{...}}` + QR). |
| `print_documents` | Dokumenty DoP/DWU (ZPL) + cechy doboru: `system`, `wykonawca`, `glazing_type`, `frame_kind`. |
| `api_keys` / `api_request_logs` | Klucze API integracji + log żądań (rate limit). W bazie są też `integration_api_keys` i `api_rate_limits`. |
| `feedback` | Zgłoszenia beta (zakładka Zgłoszenia + pływający przycisk). |
| `notifications`, `order_comments`, `order_photos` | Powiadomienia, komentarze @, zdjęcia pakowania (mobile). |

**RPC (funkcje SQL w bazie)**: `create_bot_order` (mapowanie payloadu
konfiguratora → orders), `update_order_stage`, `verify_api_key`, `check_rate_limit`,
`log_api_request`, `consume_stock_for_order` / `return_stock_for_order` (starszy
model, nadal w użyciu w części ścieżek), `revalidate_bot_order`, `generate_api_key`,
`archive_old_orders`, `current_user_is_admin`, `current_user_is_manager`.
Magazyn/rezerwacje: `reserve_stock_for_order`, `preview_order_stock`,
`release_stock_for_stage`, `release_remaining_for_order`, `cancel_reservation`,
`cancel_order_reservations`, `report_damage`, `open_inventory_session`,
`close_inventory_session`, `get_stock_alerts`, `match_recipes_for_order`.
Dopasowanie receptur (`match_recipes_for_order`, `preview_order_stock`) porównuje kryteria
przez `_recipe_norm()` — bez polskich znaków i podwójnych spacji („DAB ZLOTY" z Excela = „DĄB ZŁOTY"
ze słownika); od 7.11.2026, zob. `supabase/sql/recipe_match_diacritics.sql`.

⚠️ Starsze RPC żyją TYLKO w Supabase (nie w repo) — przed zmianą wyciągnij aktualną
wersję: `select pg_get_functiondef(oid) from pg_proc where proname='NAZWA';`
Nowsze (rezerwacje, inwentaryzacja, zniszczenia) mają definicje w `migrate/*.sql`,
ale baza mogła odjechać od pliku — przed edycją i tak porównaj z `pg_get_functiondef`.

---

## 4. Kanały wejścia zleceń i deduplikacja

| Kanał | Funkcja | Dedup | Numeracja |
|---|---|---|---|
| Formularz w aplikacji | `useOrders.handleSaveOrder` | — | max+1 w kategorii |
| Konfigurator (BOT) | Edge `orders-intake` → RPC `create_bot_order` | po `recordId` (airtable_id) | max+1 w kategorii |
| Excel | Edge `orders-excel-intake` (w Supabase pod nazwą **`dynamic-handler`**) | po (kategoria + numer zlecenia) z porównaniem treści; bliźniak z bota po numerze klienta (21 dni) albo — gdy numer nieporównywalny („-") — po treści (firma+model+szer+wys+kolor+strona+ilość, 6 h); przy konflikcie numeru arkusza identyczny wiersz z Excela z ostatnich 6 h = duplikat (4.11.2026) | numer z arkusza |

Wszystkie trzy kanały po utworzeniu zlecenia wołają `reserve_stock_for_order`
(rezerwacja magazynowa — sekcja 6).

### 4a. Status RO z Optimy (od 4.11.2026)

Zamówienia z konfiguratora zakłada w Optimie Make (scenariusz „Dodaj zamówienie do
ERP (API Optima)"), a wynik odkłada w aplikacji przez edge `erp-status` (klucz z
`api_keys`) → `set_erp_status(airtable_id, ro, status, error)`. Kolumny
`orders.erp_ro_number / erp_status (POMYŚLNY | NIEPOMYŚLNY | null) / erp_error /
erp_updated_at` pisze **wyłącznie Make**; frontend tylko czyta (poprawki w Airtable:
„Błędy automatyzacji (Optima)" → Ponów wysyłkę). RO bywa wcześniej niż zlecenie w
aplikacji — status czeka w `erp_status_by_airtable` i dopina go trigger BEFORE INSERT
`trg_orders_apply_erp_status`. `set_erp_status` kopiuje status na partnera pary
Disting Plus i nogi Titana.

W aplikacji (`src/lib/erpStatus.ts` jako jedyne miejsce interpretacji):
- plakietka przy numerze zlecenia (`ErpStatusBadge` w `orderNumberCol`): zielona
  `RO 231/11/2026`, czerwona `Błąd ERP` (tooltip z treścią), nic gdy null;
- sekcja „Optima (RO)" w oknie zlecenia (`OrderErpSection`, tylko odczyt);
- Weryfikacja → sekcja „Błędy ERP (Optima)" (`erpErrors` w `useWarehouse`, to samo
  odświeżanie co weryfikacja, co 60 s), licznik w sidebarze, kafelek na Pulpicie;
- powiadomienia: trigger `trg_notify_erp_error` (`migrate/erp_status_powiadomienia.sql`)
  → `notifications.type = 'erp_error'` dla admin / manager / kierownik_produkcji /
  kierownik_firmowy, tylko dla wiersza z `airtable_id` (partnerzy pary i nogi Titana
  go nie mają → jedno powiadomienie na zamówienie), ten sam błąd nie powtarza się
  przez dobę; indeksy `orders_erp_error_idx`, `orders_erp_ro_number_idx`.

- **„Ponów wysyłkę do Optimy"** (sekcja Optima w oknie zlecenia i lista błędów w
  Weryfikacji, tylko kierownik, potwierdzenie, blokada 30 s per zlecenie): hook
  `useErpRetry` → edge `erp-retry` → webhook Make. Adres webhooka trzyma
  `integration_settings.erp_retry_webhook_url` (tabela klucz/wartość, RLS: tylko
  admin; UI: Konfiguracja → Integracje), funkcja czyta go service_role. Warunki:
  zlecenie ma `airtable_id` i `erp_status = NIEPOMYŚLNY`; payload
  `{action:'erp_retry', airtable_id, order_id, order_number, category, company,
  previous_error, requested_by, requested_at}`; każde wysłanie w `audit_log`
  (`action: erp_retry`). Kolumn `erp_*` funkcja nie dotyka — status wraca od Make.
- szukanie po numerze RO w tabelach kategorii („231/11"), RO w Wysyłce (plakietka)
  i w Archiwum (kolumna + szczegóły; `orders_archive` ma kolumny `erp_*`,
  `migrate/erp_retry_integracje.sql`).

Na później (nie zamykać drogi): porównanie stanów i rezerwacji Optimy ze
`stock_reservations`, RO → faktura po wydaniu.

**Duble bot↔excel** (rozwiązane 2026-09-08): zlecenia konfiguratora wchodzą i przez
API, i przez Excel (arkusz musi je mieć — pracują z niego handlowcy), więc
`orders-excel-intake` robi **dedup krzyżowy**: wiersz jest pomijany
(`status: duplicate_bot`), gdy istnieje botowe zlecenie z ostatnich 21 dni o tej
samej kategorii + firmie + numerze zamówienia klienta. Ograniczenia: numery
puste/`-` nie są porównywane, a wiersz z Excela zaimportowany PRZED strzałem bota
przejdzie — takie resztki łapie sekcja „Podejrzane duble" w zakładce Weryfikacja
(detekcja po tej samej regule + liczniki etapów do decyzji, którą kopię anulować).

**Autor zlecenia** (`entered_by`, kolumna WPISAŁ): Excel — z kolumny „Wpisał"
(warianty: Wpisal/Operator/Handlowiec); bot — `BOT (Konfigurator)`.

---

### 4b. Synchronizacja wydań z Excela — widok w aplikacji (od 6.11.2026)
Backend żyje poza aplikacją: Make (scenariusz 10117480, harmonogram daily 20:00) pobiera
pliki „Zamówienia *.xlsm" z OneDrive → edge function `excel-sync` (nagłówek
`x-sync-secret` = `integration_settings.excel_sync_secret`) → RPC
`sync_releases_from_excel` → wiersz per plik/kategoria w `excel_sync_runs`
(RLS: SELECT dla kierowników; `details` = tablica pozycji ze statusami
`do_zamkniecia / zamknieto / w_realizacji / duplikat / anulowane_w_excelu / inne`,
`powiazane_id` = pozostałe zlecenia dopasowane do tego samego wiersza).
Aplikacja NICZEGO nie dopasowuje ani nie zamyka: `hooks/useExcelSync.ts`
czyta ostatni przebieg każdej kategorii (limit 21 wierszy, grupowanie po
`summary.kategoria`), dociąga zlecenia z `orders` i w `deriveExcelSync` (czysta
funkcja, test `excelSync.test.ts`) buduje listy do decyzji: grupy duplikatów
po `excel_row` (znikają, gdy zostało ≤ 1 otwarte; BOT pierwszy = zostaje),
anulowane w Excelu (znikają po anulowaniu w aplikacji), inne (znikają po
anulowaniu/wydaniu). UI: `ExcelSyncReviewSection` w Weryfikacji (akcja
„Anuluj zlecenie" = istniejąca ścieżka `handleCancelReviewOrder`), kafelek na
Pulpicie (czas ostatniego przebiegu, ostrzeżenie > 26 h), licznik w menu.
Odświeżanie co 5 min + ręcznie. Trigger `trg_zz_flag_possible_duplicate`
(BEFORE INSERT) flaguje duble przy imporcie — dziś 0 otwartych.

Dopasowanie wiersz ↔ zlecenie (od 20.11.2026, `migrate/excel_sync_dopasowanie_duplikaty.sql`):
numer arkusza + model + firma w arkuszu wykonawcy → to samo bez wykonawcy (zlecenie bez
`wykonawca`/`typ`, tylko gdy jednoznacznie) → Airtable ID → zgadywanie po nr klienta + model,
ale tylko w wierszach niezajętych przez pewne dopasowanie (wcześniej zgadnięte zlecenie robiło
z pewnego wiersza „duplikat” i blokowało oba). Źródło funkcji: `supabase/functions/excel-sync`
(od 20.11 w repo; wdrożenie `supabase functions deploy excel-sync --no-verify-jwt --use-api`
z folderu bez `supabase/config.toml` albo przez MCP). Titan w ST.xlsm: zapasowa kolumna
„ETAP 4 (montaż, pakowanie i kontrola jakości)” (arkusz WZ TITAN jej nie ma — opcjonalna);
wydanie roli ST zamyka też rolę Bastion z tej samej `titan_group`.

**Etapy z Excela → program (od 24.11.2026, `migrate/excel_sync_etapy.sql`):** ten sam nocny przebieg
czyta kolumny etapów (inicjały) z arkuszy zamówień, rozpoznane po wzorcach nagłówków per kategoria
(`STAGE_RULES` w `supabase/functions/excel-sync/index.ts`: ST/Techniczne CNC→cnc, OŚCIEŻNICA→osc, SKRZYDŁO→skr,
MONTAŻ→mon, MAGAZYN→mag; Disting CNC→e1+e3, OŚCIEŻNICA→e2_1, PAKOWANIE DOSTAWKI→e2_2, SKRZYDŁO→e4, MONTAŻ→e5;
STA ETAP n→en; Titan ST ETAP 1–4→e1–e4, Titan STA „frezowanie otworów”→e3; Bastion 9 kolumn→9 kluczy).
Wartości: inicjały 1–3 litery; „S2”/„3K”/„W1J1”/„M5S7” = osoba + numer sztuki (Tymek 24.11) → osoba z największą liczbą
sztuk (remis = pierwsza), komórka z kilkoma osobami dodatkowo w raporcie nietypowych jako informacja; X i „--”→`#ND` (Tymek 24.11: dwa myślniki = nie dotyczy), WSTRZYMANE→`#WS:Excel`, „-”/puste pomijane, reszta (P/Z,
NIE FREZOWAĆ…) tylko do raportu. Po dopasowaniu wierszy (items z `sync_releases_from_excel`, bez duplikatów
i anulowanych) RPC `sync_stages_from_excel(p_items, p_dry_run, p_run_id, p_category)` uzupełnia TYLKO puste
etapy w `orders.production_stages` (program ma pierwszeństwo; `#ND` zwalnia rezerwacje etapu jak w aplikacji)
i dopisuje do tego samego wiersza `excel_sync_runs` pola `summary.etapy` (zlecen / uzupelnione / zgodne / rozne /
nietypowe / wydano_pozycji / wymuszone_pozycji / bledy_wydania), `etapy_zmiany` (do 300), `etapy_rozne`, `etapy_nietypowe`,
`etapy_wymuszone`, `etapy_bledy_wydania`. **Wydanie z magazynu (od 24.11 wieczorem, `migrate/excel_sync_etapy_wydanie.sql`, Tymek: „Tak,
wymuszaj”):** zwykły etap wpisany z Excela wydaje materiał tak samo jak odhaczenie w aplikacji – `release_stock_for_stage(id, etap, p_force => true)`
(rezerwacje etapu → zbiorcze WZ, stan fizyczny w dół, przy braku stan schodzi na minus i WZ dostaje „[WYMUSZONE brak N]”; `created_by` null, bo woła
go service role). Wcześniej RPC pisał sam etap, a wydanie robiła tylko aplikacja (`useOrders.runStockRelease` przed `update_order_stage`) – po
pierwszym zapisie 24.11 zostało 1153 aktywnych rezerwacji w 132 zleceniach; dogonione jednorazowo tym samym wywołaniem (1153 WZ, 725 na minus).
Błąd wydania nie blokuje zapisu etapu (trafia do `etapy_bledy_wydania`). Mirrory pary (`dist_*`/`sta_*`) nie są pisane z Excela, więc nie wydają. Tryb: `integration_settings.excel_sync_etapy`
= `off` | `dry` (podgląd, bez zapisu) | `on`; start w `dry` (24.11), przełączenie na `on` po przeglądzie pierwszego raportu.
**Włączone `on` 24.11 wieczorem** (pierwszy zapis: 715 etapów w 432 zleceniach). **Mapa inicjałów** (`integration_settings.excel_sync_inicjaly`, JSON per kategoria,
klucz `*` = wspólna): hala wpisuje w arkuszu pojedyncze litery, program zna pracowników po inicjałach z profilu — STA/STA_TITAN: K→DK (Damian Krasuski),
M→MK (Mariusz Kuśka), S→KS (Kamil Szczepanik), P→PP (Paweł Popek), B/BP→BP (Piotr Popek); litera bez mapy zostaje jak w Excelu.
**Na żywo (od 24.11):** drugi scenariusz Make 10229545 „Etapy i wydania z Excela na żywo” – wyzwalacz OneDrive „Watch Files/Folders”
(folder główny, wg daty modyfikacji) co 15 min pn–pt 6–18, filtr na 4 nazwy „Zamówienia *.xlsm”, zmieniony plik → ten sam `excel-sync`
(`source=na żywo: <plik>`). Nocny 20:00 zostaje jako siatka bezpieczeństwa; wiersz w `excel_sync_runs` powstaje per plik/kategoria jak dotąd.

### 4c. Reklamacje z Excela — jedna strona Excel → aplikacja (od 19.11.2026)
Ten sam nocny przebieg: `excel-sync` czyta z każdego skoroszytu arkusz „Reklamacje"
(układ kolumn różni się między plikami, stąd aliasy nagłówków w funkcji: ST/Disting/STA
mają NR. REKLAMACJI / DATA REKLAMACJI / PA-CA-WZ / CO REKLAMOWANE / POWÓD REKLAMACJI /
WYDANIE + kolumny etapów naprawy, Bastion ma NUMER REKLAMACJI / DATA / NR KR CENTER /
UWAGI / UWAGI 2 / ZREALIZOWANE) i woła RPC `sync_complaints_from_excel(p_rows, p_category,
p_source, p_dry_run)` (`migrate/excel_sync_reklamacje.sql`). Klucz wiersza:
`extra_fields.excel_nr = '<kategoria>/<nr z arkusza>'`, numer w aplikacji `XL/<kategoria>/<nr>`
(reklamacje wpisane w aplikacji mają dalej `RK/rok/nnn`). Zlecenie dopinane po numerze
(pierwszy człon przed „-"), kategorii, wykonawcy (PA/PD → Profil, CA/CD → Center, WZ) i
pierwszym słowie firmy; brak dopasowania = reklamacja bez zlecenia (stare numery).
Disting Plus w arkuszu STA (ustalenie 23.11): skrzydło = reklamacja pod zleceniem STA
(parą Distinga), ościeżnica = pod Distingiem — jak podział etapów produkcji; wiersz STA
„DISTING PLUS” szuka najpierw zlecenia Disting, potem przechodzi na jego `linked_order_id`.
Etapy naprawy → `production_stages` z kluczami ST (cnc/osc/skr/mon/mag), WYDANIE/ZREALIZOWANE
→ `release_date` (data albo dzień przebiegu, gdy tylko znacznik). Excel wygrywa przy
kolejnych przebiegach (data, powód, etapy, wydanie gdy w aplikacji puste); parametr
`?reklamacje=0` pomija blok. Błąd reklamacji trafia do `excel_sync_runs`
(`summary.blad`) i NIE przerywa łańcucha wydań w Make (odpowiedź 200). Otwarte reklamacje
(bez wydania) widać w zakładce Reklamacje i jako zadania naprawy na mobilnym.

### 4d. Zamówienia ze sklepu (Baselinker) w CRM — tylko odczyt (od 25.11.2026, beta.153)
Zgłoszenia #144/#153, etap 1. Edge Function `crm-bl-sync` (źródło w `supabase/functions/crm-bl-sync`,
`verify_jwt: false`, autoryzacja nagłówkiem `x-internal-key` jak pozostałe funkcje CRM) czyta
z API Baselinkera `getOrderStatusList`, `getOrderExtraFields` i `getOrders` (także niepotwierdzone,
z polami dodatkowymi) od `max(crm.ustawienia.bl_sync_od = 2026-11-01, dziś − 60 dni)`, stronicując po
`id_from`, i robi upsert do `crm.zamowienia_sklep` (klucz `bl_id`, pozycje w JSON, surowa odpowiedź
w `surowe`) oraz `crm.bl_statusy`. Nowemu zamówieniu przypina klienta CRM (`lead_id`) po telefonie /
mailu (`crm.znajdz_leada`, bez dopasowania po domenie). Woła ją pg_cron `crm_bl_sync` co 15 min,
rpc `crm.odswiez_zamowienia_bl(p_bl_id)` (przycisk „Odśwież”) i zapis tokenu. Token: vault
`crm_bl_token`, zapis tylko przez rpc `crm.ustaw_token_bl` (superadmin, CRM → Ustawienia →
Baselinker), odczyt `crm.token_bl()` tylko dla service_role. Wynik ostatniego przebiegu w
`crm.ustawienia` (`bl_sync_ostatni_at`, `bl_sync_ostatni_wynik`, `bl_sync_ostatni_blad`).
Powiązanie ze zleceniami: widok `crm.v_zamowienia_sklep_zlecenia` (security invoker) = zlecenia,
których `client_order_number` zaczyna się 8 cyframi numeru BL, a firma to PO DRZWI / PODRZWI
(`crm.bl_id_zlecenia`), plus ręczne `dodane` i minus `odpiete` z `crm.zamowienia_sklep_zlecenia`.
Status produkcji i „wymaga uwagi” liczy aplikacja (`src/lib/crmZamowienia.ts`, etapy przez
`countCompletedStages`), ekran `src/components/crm/CrmZamowieniaScreen.tsx`. Rpc
`crm.klient_zamowienia_sklep` znajduje albo zakłada klienta (zrodlo `inne`, kampania `sklep`,
od razu „wygrany”). Migracja: `crm_zamowienia_sklep` (konektor). Etap 2 (zmiana statusu w BL,
mail, reklamacja z karty) wymaga osobnego zapisu do API — dziś funkcja niczego w BL nie zmienia.
Przesyłki (beta.155, migracja `crm_zamowienia_sklep_paczki`): dla zamówień z `paczka_nr` funkcja woła
`getOrderPackages` najwyżej co godzinę (`paczki_at`), aż wszystkie paczki mają tracking_status 5/6/9/10, max 40 zamówień
na przebieg; wynik w `crm.zamowienia_sklep.paczki` (`[{nr, kurier, status, status_at, zwrot}]`). Kody BL: 0/1 list
wygenerowany, 2 nadana, 3 nie doręczona, 4 w doręczeniu, 5 doręczona, 6 zwrot, 7 awizo, 8 w punkcie, 9 zagubiona,
10 anulowana, 11 w drodze. Kurier sklepu to Rohlig Suus (`rohligsuus`), który zwraca 0, dopóki nie zeskanuje paczki.

### 4e. Drzwi wewnętrzne z Optimy — rezerwacje odbiorcy (od 26.11.2026, beta.157)

Import robi edge function `optima-ro-import` (pg_cron `optima_ro_import_*` co godzinę) z baz Optimy KR Center
i MR Profil — **poza aplikacją, nie zmieniać jej z poziomu frontu**. Jedno RO = jedno zlecenie `orders`
(`category = 'DrzwiWewnetrzne'`, `source = 'optima_ro'`, unikalność: `source_metadata->>'optima_key'` = `KR:<id>` / `MR:<id>`).
Przy każdej zmianie RO import nadpisuje `order_number`, `erp_ro_number`, `erp_status`, `company`, `client_order_number`,
`order_date`, `quantity`, `notes`, `entered_by`, `source_metadata` oraz **kasuje i wstawia na nowo wszystkie pozycje**
`order_internal_door_items` (id pozycji się zmieniają — nie trzymać do nich referencji). Pól produkcyjnych
(`release_date`, etapy, `shipped_*`, reszta `extra_fields`) nie rusza; `extra_fields.cancelled` + `cancelled_reason`,
gdy RO straciło wszystkie pozycje drzwi wewnętrznych. Pozycje mają `optima_code/name/group/element_id`, `unit`;
`component_id` może być NULL — import dopina go z `optima_component_map` (ręczna mapa kod → komponent), potem po
`warehouse_components.code = optima_code`. `issue_internal_door_stock` pomija pozycje bez komponentu.

Aplikacja (`src/lib/optimaRo.ts`): lista i filtry (`InternalDoorOrdersTable`, `InternalDoorFiltersBar`), szczegóły
(`InternalDoorOrderDetailsModal` — pola z Optimy tylko do odczytu, „Powiąż z komponentem”), edycja tylko wentylacji
(`InternalDoorOrderModal`), ekran Magazyn → Komponenty → Kody Optimy (`warehouse/OptimaCodesView`), karta
Ustawienia → Integracje → Optima → Drzwi wewnętrzne (`config/OptimaSyncCard`, czyta `optima_ro_sync_state`,
„Synchronizuj teraz” = rpc `optima_ro_import_now`, tylko `current_user_is_manager()`). Magazyn dla zleceń z Optimy
schodzi przy „✓ Wydane” (ręczne zlecenia — przy zapisie); `issue_internal_door_stock` liczy różnicę netto, więc
„Dolicz wydanie” po późniejszym powiązaniu kodu jest bezpieczne. Pozycje nie mają kanału realtime — po zdarzeniu
na `orders` w tej zakładce aplikacja dociąga pozycje (debounce 1,5 s).

Powiązanie kodu: `mapOptimaCode` → rpc `optima_map_component(p_code, p_component_id)` (migracja
`migrate/optima_component_map_rpc.sql`, security definer, role jak polityka `ocm_write`: upsert mapy + przepięcie
wszystkich pozycji z kodem). Bez tej funkcji w bazie aplikacja robi upsert + update z klienta — to działa tylko dla
kierowników, bo UPDATE na `order_internal_door_items` (polityka `oidi_modify_mgr_seller`) nie obejmuje magazyniera.

Magazyn wewnętrzne (beta.158, `src/lib/internalWarehouse.ts`): komponenty `product_category LIKE 'door_%'` (nowa wartość
`door_accessory`; CHECK dokłada import albo `migrate/door_accessory_category.sql`, warunkowo) zakłada import kartotek Optimy
z `notes = 'Import z kartotek Optimy (…)'` — takich nie usuwamy (App.handleDeleteWarehouseComponent → `is_active = false`), a
formularz drzwi edytuje tylko logistykę. Bastion nigdy nie jest „drzwiami wewnętrznymi” (`internalDoorComponents` wycina surowce
i nazwy z BASTION). Inwentaryzacja otwarcia: `open_inventory_session` dla magazynu WEW* bierze wszystkie aktywne komponenty
spoza `raw` (stan 0) — bez zmian w bazie; `InventoryView` ma filtry, strony po 100 i Enter → następna pozycja. Stany →
Wewnętrzne (`InternalStockView`): rezerwacja = suma pozycji otwartych zleceń (niewydane, nieanulowane) minus netto WZ−ZWR
tego zlecenia (ręczne schodzą przy zapisie, z Optimy przy „Wydane” — bez odejmowania ręczne liczyłyby się podwójnie).

Dane z importu (beta.159): `order_internal_door_items.item_type` (door_wing / door_frame / door_handle / door_hinge_cover /
door_accessory) grupuje pozycje w szczegółach (`groupItemsByType`, przy ręcznych typ z kategorii komponentu);
`orders.quantity` w RO = liczba skrzydeł (`wingCount`); RO bez skrzydła i ościeżnicy (same TECHNIC, Bastion) nie tworzą
zleceń. Komponenty: `category = 'DRZWI WEWNĘTRZNE'` (`isInternalDoorComponent`), pola door_* mogą być NULL.
`optima_ro_sync_state.running_until > now()` = „trwa synchronizacja” (`isSyncRunning`). Braki przy wydaniu
(`internalShortages`) tylko ostrzegają — `issue_internal_door_stock` pozwala zejść poniżej zera.

## 5. Rekordy łączone (Disting Plus, Titan)

Rekordy łączone to **osobne wiersze** w `orders` spięte `linked_order_id`
(+ `extra_fields.titan_group` dla trójek Titan). Tworzone automatycznie w **trzech
miejscach** (formularz aplikacji + obie Edge Functions) — logika musi być spójna!

- **DISTING PLUS** (dokładna nazwa systemu): para Disting (ościeżnica: E1/E2.1/E2.2/E5)
  ↔ STA (skrzydło: E3/E4). Mirror etapów przez RPC `update_order_stage`; edycja pól
  produktowych synchronizuje się w obie strony (`syncSharedFieldsToLinkedPartner`).
- **Titan** (systemy zawierające `CORE`, `GUARD RC2`, `GUARD RC3`): trójka
  STA (skrzydło: E3, E5) + ST (tylko OŚCIEŻNICA) + Bastion (okuwanie→montaż→pakowanie).
  Bastion widzi chipy OŚC/SKRZ = czy ST/STA wydały swoje części. Noga Titan
  w Bastionie nie ma standardowych etapów Bastiona (ościeżnica robiona w ST) —
  patrz `stationLogic.ts`.
- Wydanie (`release_date`) jest **niezależne** per rekord — nigdy nie wiązać.

⚠️ Pułapka: `TRUNCATE orders` / usuwanie zrywa `linked_order_id` (ON DELETE SET NULL) —
partnerzy zostają jako „zwykłe" rekordy. Naprawa: re-link po numerach arkuszy
(`migrate/relink_disting_plus.sql`).

---

## 6. Magazyn — model rezerwacji (dwustopniowy) ⭐

Od września 2026 (beta.34, `migrate/rezerwacje_tura1..8.sql`) magazyn działa
dwustopniowo: **rezerwacja przy utworzeniu zlecenia → wydanie fizyczne (WZ) przy
oznaczeniu etapu**. Wcześniejszy model (zejście ze stanu od razu przy dodaniu
zlecenia) już nie obowiązuje dla kategorii z etapami.

1. **Rezerwacja** — `reserve_stock_for_order(order_id)`: przy utworzeniu zlecenia
   (formularz + obie Edge Functions) rezerwuje komponenty wg receptur. Stan fizyczny
   bez zmian; rośnie `reserved_quantity`, spada `available_quantity`. Braki NIE
   blokują (rezerwacja wchodzi ze statusem `insufficient` — to ostrzeżenie).
2. **Baner braków przed zapisem** — `preview_order_stock(payload jsonb)` (tylko
   odczyt): formularz pokazuje braki + ETA dostaw z otwartych ZD zanim zapiszesz.
3. **Wydanie przy etapie** — `release_stock_for_stage(order_id, stage_key, force)`:
   oznaczenie etapu w „Moje stanowisko" / tabeli wydaje komponenty przypięte do tego
   etapu (`warehouse_recipe_components.stage_key`, kolumna „ETAP WYDANIA" w edytorze
   receptur). Komponent bez etapu (NULL) = fallback: wydanie przy **pierwszym
   ukończonym** etapie zlecenia (produkcja jest nieliniowa!).
4. **Miękka blokada** — brak fizyczny przy wydaniu → dialog „Wydaj mimo braku"
   (`p_force`): stan schodzi na minus (jawny sygnał rozjazdu), WZ dostaje
   `[WYMUSZONE]`, audyt zapisuje kto. **Produkcja nigdy nie stoi.**
5. **Wydanie końcowe** — `release_remaining_for_order(order_id, force)` przy
   oznaczeniu WYDANIA zlecenia: catch-all na wszystkie pozostałe aktywne rezerwacje
   (kategorie bez etapów: Techniczne/Drzwi wewnętrzne + ogony po nieodhaczonych
   etapach). Po wydaniu zlecenie **nigdy** nie trzyma rezerwacji.
6. **Zwolnienie** — anulowanie/usunięcie zlecenia: `cancel_order_reservations`
   (wszystkie); ręcznie per rezerwacja: `cancel_reservation` (tylko kierownik,
   podzakładka Rezerwacje). Zwalnia niewydaną resztę, wydanych sztuk nie rusza.
7. **Alerty ROP** — `get_stock_alerts`: punkt startu = DOSTĘPNE (nie fizyczne),
   „dni do wyczerpania" = symulacja osi czasu z dostawami w drodze
   (`purchase_orders.expected_delivery_date`); sugerowane zamówienie uwzględnia
   rezerwacje i w drodze.
8. **Dokumenty ruchu** — ruchy grupowane po `reference` w dokumenty (jeden wiersz
   z rozwijanymi pozycjami): `WZ-{kategoria}-{nr}-{etap}`, `INW-{sesja}`,
   `ZN-{zgłoszenie}`. Typy `INW`/`ZN` NIE wchodzą do statystyk zużycia (te liczone
   z WZ).
9. **Inwentaryzacja** — `open_inventory_session` / `close_inventory_session`
   (sesja per magazyn, spis ślepy — UI nie pokazuje stanu systemowego przy liczeniu).
   Korekta prostuje wyłącznie stan fizyczny (rezerwacji nie dotyka) i NIE ucina na
   zerze — ujemne stany po wymuszeniach są legalne i to spis je prostuje.
10. **Zniszczenia / drugi gatunek** — `report_damage` (tylko kierownik; zgłoszenie
    z „Moje stanowisko", ze Stanów lub ze szczegółów zamówienia):
    - na produkcji (kontekst zlecenie+etap): zdejmuje ZAMIENNIK wzięty na
      dokończenie (zniszczona sztuka zeszła już przy „Zrobione"),
    - w magazynie (bez zlecenia): zdejmuje zniszczoną sztukę.
    Pełny ślad w `damage_reports` + audycie, ruch `ZN`.

Starsze funkcje `consume_stock_for_order` / `return_stock_for_order` pozostają
w bazie i są jeszcze używane w części ścieżek (m.in. drzwi wewnętrzne) — nie
kasować.

### 6a. Ostrzeżenia o brakach w Stanach (od 9.11.2026)

Migracje: `migrate/magazyn_poziomy_brakow.sql`, `migrate/magazyn_powiadomienia_krytyczne.sql`.
Reguła poziomu jest **tylko w bazie** — aplikacja nie liczy jej sama
(`src/lib/stockLevels.ts` tylko etykietuje, agreguje i sortuje).

- `warehouse_stock.min_quantity` — minimum **półki** (magazyn × komponent); null = nie pilnujemy.
  Hierarchia progu (`stock_min_effective`): minimum półki → Smart ROP (jak `get_all_smart_rop`)
  → `warehouse_components.min_stock_level` → brak.
- `stock_level(qty, reserved, incoming, min)` / `stock_shortage(...)` (IMMUTABLE):
  `critical` = dostępne < 0 i dostępne + w drodze < 0; `covered` = dostępne < 0, ale otwarte ZD
  pokrywają; `low` = dostępne ≥ 0, jest minimum i dostępne + w drodze < minimum;
  `inactive` = 0 / 0 / brak minimum / nic w drodze; inaczej `ok`.
  „Do zamówienia” = max(0, minimum − (dostępne + w drodze)).
- Widok `v_stock_levels` (security_invoker → RLS jak `warehouse_stock`): jedna półka = jeden wiersz,
  „w drodze” per magazyn (`stock_incoming_for`, filtr 1:1 z `get_incoming_stock_per_warehouse`),
  ok. 80 ms dla ~850 półek. Hook `useWarehouse.fetchWarehouseStock` dociąga go razem ze stanami.
- RPC `set_stock_minimums(jsonb)` — tylko kierownik (`current_user_is_manager`), upsert, brak półki → zakłada 0/0.
- Trigger `trg_stock_critical_notify` na `warehouse_stock`: powiadomienie `stock_critical`
  (admin / manager / kierownik_magazynu, dedup 24 h po tytule, `link_tab = 'Stany'`) **tylko przy
  przejściu** półki w `critical`; wyjście z krytycznego i `low` nie powiadamiają.
- UI (`StockView`): tło wiersza + tekst statusu, pasek liczników = filtr (klik gasi), domyślnie
  „najpierw braki” (krytyczne wg minusa → pokryte → niskie wg braku → OK → nieaktywne),
  kolumna DO ZAMÓWIENIA, minimum inline (klik w MINIMUM) i hurtowo (checkboxy, tryb jednego
  magazynu), w trybie „Wszystkie” edytor per magazyn pod wierszem, CSV braków, „Braki → lista zakupowa”.
  Filtr / sortowanie / magazyn pamiętane w `localStorage` (`kr-stock-view`).
- Zakładka **Alerty** liczy po staremu (stan − wszystkie rezerwacje) — nieruszona.

---

## 7. RUNBOOKI — jak wdrażać nowe rzeczy ⭐

### 7.1. Nowy **model / kolor / okucia / wizjer / szklenie / pochwyt / kolor progu…**
**Tylko UI, zero kodu.** Zakładka **Konfiguracja** (admin):
1. Wybierz kategorię (STA/Disting/ST/Techniczne/Bastion/Wewnętrzne) i słownik
   (np. „Modele", „Kolory", „Okucia").
2. Dodaj wartość (kolejność = `sort_order`).
3. Wartość od razu pojawia się w formularzu „Nowe zamówienie" tej kategorii.

Technicznie: wpis ląduje w `config_options (category, type, value)`. Lista słowników
per kategoria jest zdefiniowana w `src/constants.ts → CONFIG_DICTIONARIES` — jeżeli
potrzebny jest **nowy typ słownika** (np. „Klamki"), trzeba dopisać tam definicję
i podpiąć pole w formularzu (kod).

Po dodaniu wartości sprawdź, czy trzeba też:
- **Receptury** (Magazyn → Receptury) — jeśli nowy model/kolor ma schodzić z magazynu.
- **Wykluczenia** (Konfiguracja → Wykluczenia) — jeśli kombinacje są niedozwolone.
- **Dokument DoP** (Etykiety → Dokumenty) — jeśli deklaracja zależy od systemu/modelu.

### 7.2. Nowy **system** — zwykły (bez rekordów łączonych)
Jak 7.1 — słownik „Systemy" w Konfiguracji. Dodatkowo:
- DoP: jeżeli system ma własną deklarację → Etykiety → Dokumenty, pole „System".
- Excel: `orders-excel-intake.determineCategory()` rozpoznaje kategorię po nazwie
  systemu — patrz 7.3, czy nowy system wpadnie do właściwej kategorii.

### 7.3. Nowy **system Bastion** (nowa rodzina, np. obok BASIC/PREMIUM/BOLD/SILENT)
⚠️ **Wymaga zmiany w kodzie Edge Function.** Detekcja kategorii Bastion w imporcie
z Excela działa po słowach kluczowych:
- Plik: `supabase/functions/orders-excel-intake/index.ts`
- Stała: `BASTION_SYSTEM_KEYWORDS = ['BASIC', 'PREMIUM', 'BOLD', 'SILENT']`
- Dodaj słowo kluczowe nowej rodziny → **deploy** funkcji (patrz 8).
Plus słownik „Systemy" dla Bastiona w Konfiguracji (7.1). Konfigurator (bot) przekazuje
kategorię wprost w payloadzie — tam nic nie trzeba.

### 7.4. Nowy **system typu Titan** (tworzący trójkę STA+ST+Bastion)
⚠️ **Kod w TRZECH miejscach** (muszą być spójne!):
1. `src/utils.ts → isTitanSystem()` (formularz aplikacji),
2. `supabase/functions/orders-intake/index.ts → isTitanSystem()`,
3. `supabase/functions/orders-excel-intake/index.ts → isTitanSystem()`.
Obecnie: `CORE`, `GUARD RC2`, `GUARD RC3`. Po zmianie: build aplikacji + deploy obu
funkcji. Analogicznie **DISTING PLUS** — dokładne dopasowanie nazwy w tych samych
trzech miejscach.

### 7.5. Nowa **ościeżnica Bastion** (typ + mnożnik etykiet)
Konfiguracja → sekcja ościeżnic Bastion (`config_options`, category=Bastion,
type=`oscieznica`): wartość + `label_multiplier` (ile etykiet na sztukę)
+ `add_to_batch` (czy wchodzi do partii ościeżnic regulowanych).

### 7.6. Nowe **wymiary / poszerzenia / czasy realizacji**
- Wymiary i poszerzenia: Konfiguracja → mapa wymiarów (`dimension_map`).
- Czasy realizacji (kiedy zlecenie „zaległe"): Konfiguracja → czasy realizacji
  (`lead_time_rules`; mogą zależeć m.in. od typu ościeżnicy Bastion).

### 7.7. Nowy **szablon etykiety** / **dokument DoP**
- Etykieta QR: Etykiety → Szablony etykiet → HTML z polami `{{...}}` (lista pól
  w edytorze; źródło: `src/lib/labelRender.ts → LABEL_FIELDS`). ⭐ = domyślny
  dla kategorii. Nowe pole na etykietę = dopisanie wpisu w `LABEL_FIELDS` (kod).
- DoP/DWU: Etykiety → Dokumenty → wklej/wgraj ZPL + cechy doboru (system,
  realizator Center/Profil/WZ, szklone/pełne, ościeżnica stalowa/drewniana).
  Puste pole = „dowolne". Logika doboru: `src/lib/dopMatch.ts`.
  Pliki `.nlbl` (Zebra Designer) wymagają eksportu do ZPL.

### 7.8. Nowa **receptura magazynowa**
Magazyn → Receptury. Receptura ma **dynamiczne kryteria** doboru (dowolne pole
zlecenia + jedna lub wiele dozwolonych wartości; „nie dotyczy" = brak kryterium;
pasuje gdy KAŻDE kryterium spełnione, wygrywa najbardziej szczegółowa, remis →
nowsza). Każda pozycja komponentu ma **ETAP WYDANIA** (`stage_key`) — kiedy
fizycznie schodzi z magazynu; puste = przy pierwszym ukończonym etapie.
Rezerwacja następuje automatycznie przy dodaniu zlecenia; anulowanie zwalnia
rezerwacje (sekcja 6).

### 7.9. Nowy **użytkownik / rola / etapy pracownika**
Użytkownicy (admin): konto (login → e-mail `login@krcenter.pl`), rola, kategorie
(dla pracownika produkcji i kierownika działu), „Etapy produkcji" (co pracownik
widzi w „Moje stanowisko"). Macierz uprawnień: `src/lib/permissions.ts` —
nowe uprawnienie = dopisanie do macierzy + użycie `can(role, '...')` w UI.
⚠️ Przy nowej roli KIEROWNICZEJ pamiętaj też o bazie — patrz pułapka #9.

### 7.10. Nowy **kontrahent**
Ustawienia → Kontrahenci → *Klienci* (admin) — albo przycisk „+ Utwórz kontrahenta"
przy dopasowywaniu niedopasowanej firmy w zleceniu. Dzień trasy steruje
sortowaniem Wysyłki. Dostawców magazynu dopisuje się obok, w zakładce *Dostawcy*.

### 7.10a. Menu boczne (porządki, beta.86)
Układ grup trzyma `Sidebar.tsx` (`TAB_GROUPS`, etykiety w `TAB_LABELS`), widoczność
pozycji per rola — `tabsForUserDepartment` w `utils.ts`, tytuł nagłówka —
`sectionTitle` w `AppHeader.tsx`. Zasady: grupa = jedno pytanie użytkownika
(Zamówienia / Produkcja / Magazyn = „co mam zrobić", Analizy = „co chcę wiedzieć",
Ustawienia = „jak to ustawić"); każda rzecz w jednym miejscu; plakietka tylko tam,
gdzie ktoś ma zadziałać (Weryfikacja, Wysyłka po terminie, Zamawianie = alerty).
Magazyn to pięć zakładek (`WAREHOUSE_TABS`), każda renderuje `WarehouseView`
z podzbiorem podzakładek (`WAREHOUSE_TAB_SUBTABS` w `constants.ts`); nowa
podzakładka magazynu = dopisanie do `WarehouseSubTab` + do właściwej listy.
Integracje = `IntegrationsView` (Klucze API + webhooki Make), Kontrahenci =
`ContractorsView` (Klienci + Dostawcy), szablony etykiet żyją w Konfiguracji.

### 7.11. Nowa **kategoria produkcyjna** (nowa zakładka) — DUŻA zmiana
To pełnoprawna zmiana w kodzie; miejsca do ruszenia (minimum):
`constants.ts` (TABS, EDITABLE_CATEGORIES, stage defs, INITIAL_*_FORM,
CONFIG_DICTIONARIES), `types.ts` (FormData), nowy widok tabeli w `components/`,
formularz w `OrderFormModal`, logika zapisu w `useOrders`, `utils.ts`
(tabsForUserDepartment, createEmptyProductionStages, countCompletedStages),
`Sidebar.tsx` (TAB_GROUPS — grupa Zamówienia), `AppHeader.tsx` (sectionTitle),
`stationLogic.ts`, obie Edge Functions (determineCategory), szablony etykiet.
Zaplanuj to jako osobny, testowany etap.

### 7.12. Nowy **etap produkcji** w istniejącej kategorii
`constants.ts` → definicje etapów danej kategorii (`*_STAGE_DEFS`) +
`emptyStagesFor`/`createEmptyProductionStages` w utils i **w obu Edge Functions**
(mają własne kopie!). Stare zlecenia nie mają nowego klucza w JSON — kod traktuje
brak klucza jak „niezrobione", więc jest bezpiecznie. Dopisz etap też do
przypisań pracowników (worker_stages), ewentualnych mirrorów i sprawdź
mapowanie `stage_key` w recepturach (komponenty przypięte do etapów — sekcja 6).

---

## 8. Edge Functions — deploy

Kod funkcji w repo (`supabase/functions/...`) to **kopia robocza**. Deploy ręczny:
Supabase Dashboard → Edge Functions → funkcja → wklej całą zawartość pliku → Deploy.

| Funkcja w repo | Nazwa w Supabase | Rola |
|---|---|---|
| `orders-intake` | `orders-intake` | przyjęcie zleceń z konfiguratora (X-API-Key) |
| `orders-excel-intake` | **`dynamic-handler`** | przyjęcie zleceń z Excela (X-API-Key) |
| `manage-users` | `manage-users` | tworzenie/usuwanie kont (service role) |

Po każdej zmianie pliku w repo → deploy, inaczej produkcja jedzie na starej wersji.

---

## 9. Wydanie nowej wersji aplikacji (release)

1. **`npm test`** — ~145 testów logiki (uprawnienia, dobór DoP, etapy, mapowanie API,
   podgląd stanów, spójność 3 kopii). Czerwone = nie wydajemy.
2. Podbij `version` w `package.json` (np. `1.0.0-beta.35`) — **release sam nie podbija**.
3. `npm run release` → build (tsc+vite) + electron-builder + upload na GitHub Releases.
4. Weryfikacja: `https://api.github.com/repos/DaMesa97/kr-center-manager/releases/tags/vX`
   — muszą być `Setup.exe` + `latest.yml`.
5. Użytkownicy dostają auto-update po zalogowaniu (pobierz → restart).

Dev lokalnie: `npm run dev` (Vite + Electron). Typecheck: `npx tsc --noEmit`.
⚠️ Zmiany w `electron/main.ts` wymagają restartu deva (nie łapie ich HMR).

---

## 10. Migracje SQL

Katalog `migrate/*.sql` — skrypty odpalane **ręcznie** w Supabase SQL Editor
(aplikacja ich nie wykonuje). Konwencja: plik = jedna zmiana, komentarz na górze
mówi co robi i kiedy odpalić. Ważne pliki:

**Wykonane (historia — nie odpalać ponownie bez powodu):**
- `roles_migrate_now.sql` + `rls_hardening.sql` — migracja ról (lipiec 2026):
  nowe role + backfill kategorii, helper `current_user_is_manager()`, trigger
  anty-eskalacja (rolę zmienia tylko admin), zaostrzone polityki tabel pomocniczych.
- `fix_policies_manager_roles.sql` — hurtowa naprawa 37 polityk RLS ze starym
  `role='manager'` (26 tabel). Do ponownego użycia przy dodawaniu nowej roli
  kierowniczej (pułapka #9).
- `recipes_dynamic_criteria.sql` — receptury: dynamiczne kryteria zamiast sztywnych
  kolumn.
- `rezerwacje_tura1..8.sql` — model rezerwacji (sekcja 6): fundament, preview,
  mapowanie etapów, wymuszenie wydania, ręczne zwolnienie, alerty, wydanie końcowe,
  inwentaryzacja. `rezerwacje_tura1_testy.sql` — testy manualne modelu.
- `zniszczenia.sql` — rejestr zniszczeń + `report_damage` + ruch ZN.

**Narzędziowe / naprawcze:**
- `relink_disting_plus.sql` — naprawa zerwanych powiązań par.
- `labels.sql`, `feedback.sql`, `notifications.sql`, `order_photos.sql` — tabele modułów.
- `erp_status_powiadomienia.sql` — status RO z Optimy: trigger powiadomień `erp_error` + indeksy (sekcja 4a).
- `erp_retry_integracje.sql` — `integration_settings` (webhook „Ponów wysyłkę do Optimy") + kolumny `erp_*` w `orders_archive`.
- `alu_etapy_zkp.sql` — kolejność etapów aluminium wg ZKP (cięcie → składanie → okucia → szklenie → pakowanie) + sprawdzenie matrycy 6.27 przy oznaczaniu sztuki na zleceniu ZKP (docs/zkp/MATRYCA_6_27.md).
- `print_documents_dwu.sql`, `bastion_side_top_panel.sql`, `orders_wentylacja.sql` —
  rozszerzenia kolumn.

---

## 11. Znane pułapki (przeczytaj zanim coś „naprawisz")

1. **Etapy trzymają inicjały, nie 'T'.** „Zrobione" = komórka **niepusta**.
   Nigdy nie porównuj `=== 'T'`.
2. **Wydanie jest niezależne per kategoria** (Titan: STA/ST/Bastion osobno).
   Nie wiązać automatycznie.
3. **TRUNCATE/kasowanie orders zrywa `linked_order_id`** — patrz sekcja 5.
4. **Logika systemów specjalnych żyje w 3 kopiach** (aplikacja + 2 Edge Functions) —
   zmieniasz w jednej, zmień we wszystkich.
5. **Starsze RPC w bazie nie są w repo** — przed edycją zrzuć aktualną definicję;
   nowsze mają pliki w `migrate/`, ale baza mogła odjechać — porównaj (sekcja 3).
6. **PostgREST limit 1000 wierszy** — wszystkie pełne odczyty (`orders`, wykluczenia,
   kartoteka, stany, słowniki — naprawione w beta.31) iterują `.range()` stronami;
   nowy kod czytający dużo wierszy też musi.
7. **Duble bot/excel** — rozwiązane dedupem krzyżowym w `orders-excel-intake`
   (sekcja 4); resztki i przypadki brzegowe łapie „Podejrzane duble" w Weryfikacji.
   Zaległe duble sprzed 2026-09-08 do ręcznego wyklikania.
8. **Numeracja STA ma dwie serie** (41xx aplikacyjne, 24xx z arkusza) — przy
   wygaszaniu Excela podjąć decyzję o ujednoliceniu.
9. **Role żyją też w POLITYKACH RLS.** RLS jest wdrożone częściowo (rls_hardening:
   profile, etykiety, dokumenty, aliasy, feedback, powiadomienia; tabela `orders`
   celowo nieruszona — traktuj ją jako dostępną dla każdego zalogowanego).
   Przy zmianie modelu ról nie wystarczy przeczesać kodu — 37 polityk w 26 tabelach
   sprawdzało `role='manager'` i po migracji blokowało zapisy. Przy dodawaniu NOWEJ
   roli kierowniczej: dopisz ją do `permissions.ts`, `current_user_is_manager()`
   w bazie ORAZ przejedź polityki skryptem `migrate/fix_policies_manager_roles.sql`
   (po podmianie listy ról).
10. **Sekrety** (klucze API, service role, GH_TOKEN, Sentry) — tylko w `.env`
    (jest w .gitignore). Nigdy w kodzie ani w czacie.
11. **Ujemne stany fizyczne są legalne** — powstają przy wymuszonym wydaniu
    (`[WYMUSZONE]`) i prostuje je dopiero inwentaryzacja. Nie „naprawiać" ich
    ręcznym UPDATE ani nie ucinać na zerze w kodzie.
12. **Statystyki zużycia liczą się z WZ** — ruchy `INW` (korekty spisu) i `ZN`
    (zniszczenia) celowo mają osobne typy, żeby nie zafałszować zużycia/ROP.
    Nowy typ ruchu = decyzja, czy wchodzi do statystyk.
13. **Rezerwacje vs stan fizyczny** — `available_quantity` to kolumna GENERATED
    (fizyczny − zarezerwowane). Alerty i sugestie zamówień liczą od DOSTĘPNEGO.
    Po oznaczeniu WYDANIA zlecenie nie może trzymać żadnych rezerwacji
    (catch-all `release_remaining_for_order`).

---

## 12. Backup i bezpieczeństwo danych

- **Baza = całość firmy.** Wymagany Supabase Pro (backupy dzienne + PITR) albo
  własny `pg_dump` co noc z rotacją. Bez tego jeden błędny SQL = utrata danych.
- Konta: hasła nadaje admin; e-maile w domenie `@krcenter.pl` (login = część lokalna).
- Klucze API: rotacja/dezaktywacja w Ustawienia → Integracje → Klucze API; każdy request jest logowany.

---

*Aktualizuj ten dokument przy każdej zmianie architektury (nowy kanał wejścia,
nowa kategoria, zmiana logiki rekordów łączonych lub modelu magazynu).
Ostatnia aktualizacja: beta.34 (2026-09).*

## 13. Stolarka aluminiowa — zlecenie z listy produkcyjnej AluronCAD (od 23.10.2026)

Kategoria w bazie `Aluminium`, zakładka „Stolarka aluminiowa”. Inny model niż STA/Bastion — **nie ma formularza**, zlecenie powstaje z PDF:

- **Zlecenie = lista produkcyjna (LP)** z AluronCAD. `orders.order_number` = numer OF (np. `OF341/2026`), `source = 'alu_lp'`, dane LP w `extra_fields.alu` (lp_number, lp_created_at, deadline — termin wybrany przy imporcie, domyślnie +4 tyg., realizacja `wysylka|montaz`, powierzchnia, masa). `quantity` = suma sztuk pozycji.
- **Pozycje (konstrukcje)** w `order_alu_positions` (do ~100 na zlecenie): typ (drzwi/okno/scianka/inne), system, kolory, wypełnienia, wymiar S×W, ilość, uwagi produkcyjne (jsonb), szkło (jsonb — tylko informacyjnie; zamówienie do szklarza = plik ZM GLASS z LiczOkna). **Etapy per POZYCJA i per SZTUKA**: `production_stages = { ciecie: { done, marks[] }, okuwanie, skladanie, szklenie, pakowanie }` — etap pozycji zrobiony, gdy `done >= quantity`; każde kliknięcie dopisuje inicjały do `marks`. Helpery: `src/lib/alu.ts`.
- **PDF-y** (LP + lista cięcia LC = komplet) w prywatnym bucket `order-documents` (`aluminium/<order_id>/<kind>_<ts>.pdf`), metadane w `order_documents` (UNIQUE (order_id, kind) — nowy plik zastępuje stary; `order_number` snapshot przeżywa archiwizację). Otwieranie: signed URL (10 min) → `shell.openExternal` przez IPC `shell:open-external`.
- **Parser** `src/lib/aluLpParser.ts`: czyta `PdfTextPage[]` (tekst z położeniem, `src/lib/pdfText.ts` / pdfjs) — AluronCAD generuje rozjechane PDF-y, parsowanie liniowe nie działa. Strona → pozycja ze **stopki** `OF… (N)`. Wymiar konstrukcji z odcinków profilu „Ościeżnica” (heurystyka, warning gdy niepewne). Uwagi produkcyjne przepisywane „po ludzku” (`humanizeProductionNotes`). Fixtures z prawdziwych PDF-ów w `src/__tests__/fixtures/alu/` + `scripts/pdf-text-fixture.mjs` (nowy przypadek LP → nowy fixture + test).
- **Import** (`AluImportModal`): LP wymagana, LC opcjonalna, rozpoznawane po treści; wszystko do poprawki w podglądzie przed zapisem; RPC `import_alu_order(header, positions, mode)` — `check` (jeśli OF istnieje → `exists`, UI pyta: **nadpisz** = pozycje po `pos_no`, etapy zostają z `done` przyciętym do nowej ilości / **dodaj ponownie** = `OF… (2)`). Sama LC → `find_alu_order` + `attach_order_document`.
- **Uprawnienia**: import/dokumenty tylko kierownik (RPC + RLS + storage policies), odczyt authenticated. Kategoria w zawężeniu KD/PP jak inne (`worker_stages.category = 'Aluminium'`).
- Migracja: `migrate/aluminium_etap1.sql`. Etap 2 (stanowisko, wydanie, realtime pozycji) — patrz TODO.MD.
- **Etapy na stanowisku (etap 2)**: `src/lib/aluStation.ts` — `buildAluTasks(orders, positionsByOrder, workerStages)` robi zadanie per (pozycja × etap) tylko dla etapów przypisanych w `worker_stages` (category `Aluminium`); `readyCount` = ile sztuk można teraz kliknąć (limit z poprzedniego etapu − zrobione). Klik = RPC `mark_alu_position_stage(position, etap, inicjały)` → zwraca nowe `production_stages`; cofnięcie = `undo_alu_position_stage` (tylko gdy następny etap nie zużył sztuki). Guard `can_write_alu_position` (kierownik / pracownik z dowolnym etapem alu). Zlecenie wydane lub anulowane = klik odrzucony. Desktop: `MyStationView` (gałęzie `task.alu`), telefon: `MobileStationView`. Realtime: tabela `order_alu_positions` w kanale stanowiska (`mergeAluPositionEvent`).
- **Postęp zlecenia**: trigger `trg_alu_positions_progress` po każdej zmianie pozycji przepisuje `{ done, total, percent }` do `orders.extra_fields.alu.progress` (`migrate/aluminium_etap2_postep.sql`); `countCompletedStages(order)` dla Aluminium czyta to pole — Wysyłka, Pulpit, mobile i statystyki nie dociągają pozycji. Koszt: każdy klik sztuki = UPDATE orders (wpis w audycie).
- **Wysyłka**: `getOrderRouteDay` dla Aluminium = dzień tygodnia z `alu.deadline` (jak `route_day` firm, np. PIĄTEK), realizacja `montaz` = grupa `Montaż własny` (`ALU_MONTAZ_ROUTE`) + chip MONTAŻ. Wydanie jak w innych kategoriach (`release_remaining_for_order` jest no-op — brak rezerwacji).
- **Dokumenty**: `order_documents.kind` ∈ LP / LC / **ZM** (ZM GLASS z LiczOkna — zamówienie szyb; szyby alu nie przechodzą przez zakładkę Szyby). Nowy rodzaj → check constraint + walidacja w `attach_order_document` (`migrate/aluminium_etap3_zm_glass.sql`).
