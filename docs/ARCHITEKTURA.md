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
| `company_aliases` | Zapamiętane dopasowania nazw z konfiguratora → kontrahent (trigger podmienia przy INSERT z bota). |
| `warehouse_components` / `warehouse_stock` / `warehouse_movements` | Kartoteka, stany per magazyn, ruchy. `warehouse_stock` ma `reserved_quantity` + `available_quantity` (kolumna GENERATED: fizyczny − zarezerwowane). Typy ruchów: `PZ`/`WZ`/`MM`/`ZWR`/`INW`/`ZN` (+ legacy `in`/`out`); ruchy grupowane w dokumenty po `reference`. |
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
| Excel | Edge `orders-excel-intake` (w Supabase pod nazwą **`dynamic-handler`**) | po (kategoria + numer zlecenia) | numer z arkusza |

Wszystkie trzy kanały po utworzeniu zlecenia wołają `reserve_stock_for_order`
(rezerwacja magazynowa — sekcja 6).

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
Kontrahenci (admin) — albo przycisk „+ Utwórz kontrahenta" przy dopasowywaniu
niedopasowanej firmy w zleceniu. Dzień trasy steruje sortowaniem Wysyłki.

### 7.11. Nowa **kategoria produkcyjna** (nowa zakładka) — DUŻA zmiana
To pełnoprawna zmiana w kodzie; miejsca do ruszenia (minimum):
`constants.ts` (TABS, EDITABLE_CATEGORIES, stage defs, INITIAL_*_FORM,
CONFIG_DICTIONARIES), `types.ts` (FormData), nowy widok tabeli w `components/`,
formularz w `OrderFormModal`, logika zapisu w `useOrders`, `utils.ts`
(tabsForUserDepartment, createEmptyProductionStages, countCompletedStages),
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
- Klucze API: rotacja/dezaktywacja w zakładce Klucze API; każdy request jest logowany.

---

*Aktualizuj ten dokument przy każdej zmianie architektury (nowy kanał wejścia,
nowa kategoria, zmiana logiki rekordów łączonych lub modelu magazynu).
Ostatnia aktualizacja: beta.34 (2026-09).*
