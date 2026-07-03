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
src/hooks/useWarehouse.ts   – magazyn (stany, PZ/MM, receptury, ROP)
src/hooks/useConfig.ts      – słowniki konfiguracji
src/hooks/useAuth.ts        – logowanie, sesja, profil
src/lib/permissions.ts      – RBAC: role + macierz uprawnień (can/isManagerRole)
src/lib/labelRender.ts      – render etykiet HTML + pola {{...}}
src/lib/dopMatch.ts         – dobór dokumentów DoP/DWU do zlecenia
src/lib/stationLogic.ts     – logika „Moje stanowisko" (blokady etapów, zadania)
src/constants.ts            – definicje etapów, słowników, zakładek, formularzy
src/utils.ts                – funkcje pomocnicze (widoczność zakładek, parsowanie)
src/components/*            – widoki (m.in. 4 tabele zleceń per kategoria)
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
        (Disting Plus para, Titan trójka) + zejście                 │
        komponentów z magazynu wg receptur                          │
                                                                    ▼
   ETAPY PRODUKCJI (inicjały w production_stages JSON)  ◄── pracownicy
        │ mirror etapów między rekordami łączonymi (RPC update_order_stage)
        ▼
   WYDANIE (release_date per kategoria, niezależnie) ──► Wysyłka ──► Archiwum
                                                                    (orders_archive)
   MAGAZYN: warehouse_components/stock/movements ◄── PZ/MM/receptury/anulowanie
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
| `company_aliases` | Zapamiętane dopasowania nazw z konfiguratora → kontrahent (trigger podmienia przy INSERT z bota). |
| `warehouse_components` / `warehouse_stock` / `warehouse_movements` | Kartoteka, stany per magazyn, ruchy (PZ/MM/zejścia/zwroty). |
| `warehouse_recipes` / `warehouse_recipe_components` | Receptury — co schodzi ze stanu na zlecenie (dobór po kategorii/systemie/modelu/kolorze). |
| `warehouses` | Definicje magazynów (Bukowa, Marklowicka, Wewnętrzne #1/#2). |
| `purchase_orders` / `purchase_order_items` | Zamówienia do dostawców. `suppliers` — dostawcy. |
| `label_templates` | Szablony etykiet HTML per kategoria (pola `{{...}}` + QR). |
| `print_documents` | Dokumenty DoP/DWU (ZPL) + cechy doboru: `system`, `wykonawca`, `glazing_type`, `frame_kind`. |
| `api_keys` / `api_request_log` | Klucze API integracji + log żądań (rate limit). |
| `feedback` | Zgłoszenia beta (zakładka Zgłoszenia + pływający przycisk). |
| `notifications`, `order_comments`, `order_photos` | Powiadomienia, komentarze @, zdjęcia pakowania (mobile). |

**RPC (funkcje SQL w bazie, poza repo!)**: `create_bot_order` (mapowanie payloadu
konfiguratora → orders), `update_order_stage`, `verify_api_key`, `check_rate_limit`,
`log_api_request`, `return_stock_for_order`, `revalidate_bot_order`,
`generate_api_key`, `archive_old_orders`, `current_user_is_admin`.
Ich definicje żyją TYLKO w Supabase — przed zmianą wyciągnij aktualną wersję:
`select pg_get_functiondef(oid) from pg_proc where proname='NAZWA';`

---

## 4. Kanały wejścia zleceń i deduplikacja

| Kanał | Funkcja | Dedup | Numeracja |
|---|---|---|---|
| Formularz w aplikacji | `useOrders.handleSaveOrder` | — | max+1 w kategorii |
| Konfigurator (BOT) | Edge `orders-intake` → RPC `create_bot_order` | po `recordId` (airtable_id) | max+1 w kategorii |
| Excel | Edge `orders-excel-intake` (w Supabase pod nazwą **`dynamic-handler`**) | po (kategoria + numer zlecenia) | numer z arkusza |

⚠️ **Duble**: dopóki zlecenia konfiguratora wchodzą i endpointem, i przez formularz
bota do Excela — powstają podwójnie (różne numery ⇒ dedup nie łapie krzyżowo).
Rozwiązanie przejściowe: w Make wyciąć gałąź bot→Excel.

**Autor zlecenia** (`entered_by`, kolumna WPISAŁ): Excel — z kolumny „Wpisał"
(warianty: Wpisal/Operator/Handlowiec); bot — `BOT (Konfigurator)`.

---

## 5. Rekordy łączone (Disting Plus, Titan)

Rekordy łączone to **osobne wiersze** w `orders` spięte `linked_order_id`
(+ `extra_fields.titan_group` dla trójek Titan). Tworzone automatycznie w **trzech
miejscach** (formularz aplikacji + obie Edge Functions) — logika musi być spójna!

- **DISTING PLUS** (dokładna nazwa systemu): para Disting (ościeżnica: E1/E2.1/E2.2/E5)
  ↔ STA (skrzydło: E3/E4). Mirror etapów przez RPC `update_order_stage`; edycja pól
  produktowych synchronizuje się w obie strony (`syncSharedFieldsToLinkedPartner`).
- **Titan** (systemy zawierające `CORE`, `GUARD RC2`, `GUARD RC3`): trójka
  STA (skrzydło: E3, E5) + ST (tylko OŚCIEŻNICA) + Bastion (okuwanie→montaż→pakowanie).
  Bastion widzi chipy OŚC/SKRZ = czy ST/STA wydały swoje części.
- Wydanie (`release_date`) jest **niezależne** per rekord — nigdy nie wiązać.

⚠️ Pułapka: `TRUNCATE orders` / usuwanie zrywa `linked_order_id` (ON DELETE SET NULL) —
partnerzy zostają jako „zwykłe" rekordy. Naprawa: re-link po numerach arkuszy
(`migrate/relink_disting_plus.sql`).

---

## 6. RUNBOOKI — jak wdrażać nowe rzeczy ⭐

### 6.1. Nowy **model / kolor / okucia / wizjer / szklenie / pochwyt / kolor progu…**
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

### 6.2. Nowy **system** — zwykły (bez rekordów łączonych)
Jak 6.1 — słownik „Systemy" w Konfiguracji. Dodatkowo:
- DoP: jeżeli system ma własną deklarację → Etykiety → Dokumenty, pole „System".
- Excel: `orders-excel-intake.determineCategory()` rozpoznaje kategorię po nazwie
  systemu — patrz 6.3, czy nowy system wpadnie do właściwej kategorii.

### 6.3. Nowy **system Bastion** (nowa rodzina, np. obok BASIC/PREMIUM/BOLD/SILENT)
⚠️ **Wymaga zmiany w kodzie Edge Function.** Detekcja kategorii Bastion w imporcie
z Excela działa po słowach kluczowych:
- Plik: `supabase/functions/orders-excel-intake/index.ts`
- Stała: `BASTION_SYSTEM_KEYWORDS = ['BASIC', 'PREMIUM', 'BOLD', 'SILENT']`
- Dodaj słowo kluczowe nowej rodziny → **deploy** funkcji (patrz 7).
Plus słownik „Systemy" dla Bastiona w Konfiguracji (6.1). Konfigurator (bot) przekazuje
kategorię wprost w payloadzie — tam nic nie trzeba.

### 6.4. Nowy **system typu Titan** (tworzący trójkę STA+ST+Bastion)
⚠️ **Kod w TRZECH miejscach** (muszą być spójne!):
1. `src/utils.ts → isTitanSystem()` (formularz aplikacji),
2. `supabase/functions/orders-intake/index.ts → isTitanSystem()`,
3. `supabase/functions/orders-excel-intake/index.ts → isTitanSystem()`.
Obecnie: `CORE`, `GUARD RC2`, `GUARD RC3`. Po zmianie: build aplikacji + deploy obu
funkcji. Analogicznie **DISTING PLUS** — dokładne dopasowanie nazwy w tych samych
trzech miejscach.

### 6.5. Nowa **ościeżnica Bastion** (typ + mnożnik etykiet)
Konfiguracja → sekcja ościeżnic Bastion (`config_options`, category=Bastion,
type=`oscieznica`): wartość + `label_multiplier` (ile etykiet na sztukę)
+ `add_to_batch` (czy wchodzi do partii ościeżnic regulowanych).

### 6.6. Nowe **wymiary / poszerzenia / czasy realizacji**
- Wymiary i poszerzenia: Konfiguracja → mapa wymiarów (`dimension_map`).
- Czasy realizacji (kiedy zlecenie „zaległe"): Konfiguracja → czasy realizacji
  (`lead_time_rules`; mogą zależeć m.in. od typu ościeżnicy Bastion).

### 6.7. Nowy **szablon etykiety** / **dokument DoP**
- Etykieta QR: Etykiety → Szablony etykiet → HTML z polami `{{...}}` (lista pól
  w edytorze; źródło: `src/lib/labelRender.ts → LABEL_FIELDS`). ⭐ = domyślny
  dla kategorii. Nowe pole na etykietę = dopisanie wpisu w `LABEL_FIELDS` (kod).
- DoP/DWU: Etykiety → Dokumenty → wklej/wgraj ZPL + cechy doboru (system,
  realizator Center/Profil/WZ, szklone/pełne, ościeżnica stalowa/drewniana).
  Puste pole = „dowolne". Logika doboru: `src/lib/dopMatch.ts`.
  Pliki `.nlbl` (Zebra Designer) wymagają eksportu do ZPL.

### 6.8. Nowa **receptura magazynowa**
Magazyn → Receptury: warunki doboru (kategoria/system/model/kolor/część) + lista
komponentów z ilościami. Zejście ze stanu następuje automatycznie przy dodaniu
zlecenia; anulowanie zwraca (`return_stock_for_order`).

### 6.9. Nowy **użytkownik / rola / etapy pracownika**
Użytkownicy (admin): konto (login → e-mail `login@krcenter.pl`), rola, kategorie
(dla pracownika produkcji i kierownika działu), „Etapy produkcji" (co pracownik
widzi w „Moje stanowisko"). Macierz uprawnień: `src/lib/permissions.ts` —
nowe uprawnienie = dopisanie do macierzy + użycie `can(role, '...')` w UI.

### 6.10. Nowy **kontrahent**
Kontrahenci (admin) — albo przycisk „+ Utwórz kontrahenta" przy dopasowywaniu
niedopasowanej firmy w zleceniu. Dzień trasy steruje sortowaniem Wysyłki.

### 6.11. Nowa **kategoria produkcyjna** (nowa zakładka) — DUŻA zmiana
To pełnoprawna zmiana w kodzie; miejsca do ruszenia (minimum):
`constants.ts` (TABS, EDITABLE_CATEGORIES, stage defs, INITIAL_*_FORM,
CONFIG_DICTIONARIES), `types.ts` (FormData), nowy widok tabeli w `components/`,
formularz w `OrderFormModal`, logika zapisu w `useOrders`, `utils.ts`
(tabsForUserDepartment, createEmptyProductionStages, countCompletedStages),
`stationLogic.ts`, obie Edge Functions (determineCategory), szablony etykiet.
Zaplanuj to jako osobny, testowany etap.

### 6.12. Nowy **etap produkcji** w istniejącej kategorii
`constants.ts` → definicje etapów danej kategorii (`*_STAGE_DEFS`) +
`emptyStagesFor`/`createEmptyProductionStages` w utils i **w obu Edge Functions**
(mają własne kopie!). Stare zlecenia nie mają nowego klucza w JSON — kod traktuje
brak klucza jak „niezrobione", więc jest bezpiecznie. Dopisz etap też do
przypisań pracowników (worker_stages) i ewentualnie mirrorów.

---

## 7. Edge Functions — deploy

Kod funkcji w repo (`supabase/functions/...`) to **kopia robocza**. Deploy ręczny:
Supabase Dashboard → Edge Functions → funkcja → wklej całą zawartość pliku → Deploy.

| Funkcja w repo | Nazwa w Supabase | Rola |
|---|---|---|
| `orders-intake` | `orders-intake` | przyjęcie zleceń z konfiguratora (X-API-Key) |
| `orders-excel-intake` | **`dynamic-handler`** | przyjęcie zleceń z Excela (X-API-Key) |
| `manage-users` | `manage-users` | tworzenie/usuwanie kont (service role) |

Po każdej zmianie pliku w repo → deploy, inaczej produkcja jedzie na starej wersji.

---

## 8. Wydanie nowej wersji aplikacji (release)

1. **`npm test`** — 85+ testów logiki (uprawnienia, dobór DoP, etapy, mapowanie API,
   spójność 3 kopii). Czerwone = nie wydajemy.
2. Podbij `version` w `package.json` (np. `1.0.0-beta.26`) — **release sam nie podbija**.
3. `npm run release` → build (tsc+vite) + electron-builder + upload na GitHub Releases.
4. Weryfikacja: `https://api.github.com/repos/DaMesa97/kr-center-manager/releases/tags/vX`
   — muszą być `Setup.exe` + `latest.yml`.
5. Użytkownicy dostają auto-update po zalogowaniu (pobierz → restart).

Dev lokalnie: `npm run dev` (Vite + Electron). Typecheck: `npx tsc --noEmit`.
⚠️ Zmiany w `electron/main.ts` wymagają restartu deva (nie łapie ich HMR).

---

## 9. Migracje SQL

Katalog `migrate/*.sql` — skrypty odpalane **ręcznie** w Supabase SQL Editor
(aplikacja ich nie wykonuje). Konwencja: plik = jedna zmiana, komentarz na górze
mówi co robi i kiedy odpalić. Ważne pliki:
- `roles.sql` — migracja ról (manager→admin itd.) + kolumna categories + RLS profili.
  **Odpalać dopiero, gdy cała ekipa ma wersję rozumiejącą nowe role.**
- `relink_disting_plus.sql` — naprawa zerwanych powiązań par.
- `labels.sql`, `feedback.sql`, `notifications.sql`, `order_photos.sql` — tabele modułów.
- `print_documents_dwu.sql`, `bastion_side_top_panel.sql` — rozszerzenia kolumn.

---

## 10. Znane pułapki (przeczytaj zanim coś „naprawisz")

1. **Etapy trzymają inicjały, nie 'T'.** „Zrobione" = komórka **niepusta**.
   Nigdy nie porównuj `=== 'T'`.
2. **Wydanie jest niezależne per kategoria** (Titan: STA/ST/Bastion osobno).
   Nie wiązać automatycznie.
3. **TRUNCATE/kasowanie orders zrywa `linked_order_id`** — patrz sekcja 5.
4. **Logika systemów specjalnych żyje w 3 kopiach** (aplikacja + 2 Edge Functions) —
   zmieniasz w jednej, zmień we wszystkich.
5. **RPC w bazie nie są w repo** — przed edycją zrzuć aktualną definicję.
6. **PostgREST limit 1000 wierszy** — wszystkie pełne odczyty `orders` iterują
   `.range()` stronami; nowy kod czytający dużo wierszy też musi.
7. **Duble bot/excel** — do czasu odcięcia gałęzi bot→Excel w Make (sekcja 4).
8. **Numeracja STA ma dwie serie** (41xx aplikacyjne, 24xx z arkusza) — przy
   wygaszaniu Excela podjąć decyzję o ujednoliceniu.
9. **RBAC egzekwowany głównie w UI** — do czasu wdrożenia pełnego RLS traktuj
   bazę jako dostępną dla każdego zalogowanego.
10. **Sekrety** (klucze API, service role, GH_TOKEN, Sentry) — tylko w `.env`
    (jest w .gitignore). Nigdy w kodzie ani w czacie.

---

## 11. Backup i bezpieczeństwo danych

- **Baza = całość firmy.** Wymagany Supabase Pro (backupy dzienne + PITR) albo
  własny `pg_dump` co noc z rotacją. Bez tego jeden błędny SQL = utrata danych.
- Konta: hasła nadaje admin; e-maile w domenie `@krcenter.pl` (login = część lokalna).
- Klucze API: rotacja/dezaktywacja w zakładce Klucze API; każdy request jest logowany.

---

*Aktualizuj ten dokument przy każdej zmianie architektury (nowy kanał wejścia,
nowa kategoria, zmiana logiki rekordów łączonych). Ostatnia aktualizacja: beta.25.*
