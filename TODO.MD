# KR Center App — TODO Roadmap

> Ostatnia aktualizacja: 2026-09-07 (beta.34). Szczegóły architektury: `docs/ARCHITEKTURA.md`.

## ✅ ZROBIONE

### Backend & API
- [x] Edge Function intake API (`orders-intake`)
- [x] Audit log + rate limiting (60 req/min)
- [x] Walidacja BOT orders + needs_review flag
- [x] Zakładka Weryfikacja dla managera
- [x] Dropdown kategorii do naprawy fikcyjnych
- [x] Smart ROP gospodarka magazynu
- [x] PDF zamówień do dostawcy (pdfmake)

### UI / Design System
- [x] Tura 11.1 — Design tokens w :root
- [x] Tura 11.2 — Buttony zunifikowane (24 klasy → 5 + warianty)
- [x] Tura 11.3.B — OrderFormModal szerszy + 2 kolumny STA/Disting
- [x] Tura 11.3.B.3 — InternalDoorOrderModal padding
- [x] Badge BOT w listach + filtr źródła
- [x] Sekcja Pochodzenie w modalach

### Infrastruktura
- [x] Metadane projektu (productName, version, author, description)
- [x] Build instalatora `KR Center-1.0.0-beta.1-Setup.exe`
- [x] Ikona aplikacji (logo KR Center)
- [x] git zainicjalizowany + commit history
- [x] **Sentry pełna konfiguracja produkcyjna**:
  - Renderer + main process init
  - User context z Supabase Auth
  - Release tagging (`kr-center@1.0.0-beta.1`)
  - beforeSend filtering + denyUrls
  - Environment tagging (production/development)
  - Source maps upload przy build (dotenv + .env.sentry-build-plugin)

### RBAC + RLS (lipiec 2026, beta.27+)
- [x] Migracja ról: 8 ról + kategorie per user (`roles_migrate_now.sql`, backfill wg działów)
- [x] RLS hardening: `current_user_is_manager()`, trigger anty-eskalacja roli, polityki tabel pomocniczych (`rls_hardening.sql`)
- [x] Fix 37 polityk RLS ze starym `role='manager'` w 26 tabelach (`fix_policies_manager_roles.sql`) — pułapka #9 w ARCHITEKTURA.md
- [x] Fix limitu 1000 wierszy PostgREST (beta.31) — paginacja `.range()` w wykluczeniach, kartotece, stanach, słownikach

### Magazyn — model rezerwacji (wrzesień 2026, beta.34) — Tury 1–8
- [x] Receptury z DYNAMICZNYMI kryteriami doboru (beta.30, `recipes_dynamic_criteria.sql`)
- [x] Tura 1 — fundament SQL: `stock_reservations`, `reserved_quantity` + `available_quantity` (GENERATED), rezerwacja przy utworzeniu zamiast konsumpcji
- [x] Tura 2 — baner braków przed zapisem (`preview_order_stock` + ETA dostaw)
- [x] Tura 3 — mapowanie komponentów receptur na etapy (`stage_key`, kolumna ETAP WYDANIA)
- [x] Tura 4 — wydanie z magazynu przy „Zrobione" w Moje stanowisko (miękka blokada, „Wydaj mimo braku" → stan na minus + [WYMUSZONE])
- [x] Tura 5 — widoki: Stany 5 kolumn, podzakładki Rezerwacje i W drodze, ręczne zwolnienie rezerwacji (kierownik)
- [x] Tura 6 — alerty świadome rezerwacji i dostaw w drodze (symulacja dni do wyczerpania)
- [x] Tura 7 — wydanie końcowe przy oznaczeniu wydania (`release_remaining_for_order`, catch-all)
- [x] Tura 8 — inwentaryzacja pod model rezerwacji (spis ślepy per magazyn, ruch INW, ujemne stany prostowane spisem)
- [x] Rezerwacja także z API intake (konfigurator + excel)
- [x] Ruchy grupowane w dokumenty (zbiorcze WZ/PZ, numer WZ-STA-2388-e4)
- [x] Zniszczenia / drugi gatunek: `report_damage` (tylko kierownik), zgłoszenie z Mojego stanowiska / Stanów / detali zamówienia, ruch ZN
- [x] Rezerwacje zgrupowane po zleceniach + „Zwolnij wszystkie" per zlecenie

### Inne (lipiec–wrzesień 2026)
- [x] Wentylacja: Techniczne + Drzwi wewnętrzne (beta.33, `orders_wentylacja.sql`)
- [x] Sortowanie po nagłówkach w Komponentach i Stanach (beta.29)
- [x] Moje stanowisko: noga Titan w Bastionie bez standardowych etapów (ościeżnica robiona w ST)
- [x] Profesjonalna Pomoc w aplikacji + dokumentacja techniczna, ~145 testów vitest (beta.26+)

---

## 🐛 BUGI DO NAPRAWY

### Archiwum — błąd archiwizacji
- [x] `INSERT has more expressions than target columns` — NAPRAWIONE
  - Przyczyna: `orders` miało kolumny `source` + `source_metadata` których brakowało w `orders_archive`, a funkcja robiła `SELECT *`
  - Fix: dodano `source` + `source_metadata` do `orders_archive`, przepisano `archive_old_orders` z jawną listą kolumn zamiast `SELECT *`

---

## 🔴 PRIORYTET 1 — KRYTYCZNE dla 30 userów

### Dokończenie Sentry
- [x] Sprawdzić filtry w Sentry Issues — problem był z filtrem environment (dev → `development`, dashboard domyślnie pokazuje `production`)
- [x] Sprawdzić quota (Sentry Stats & Usage) — OK, quota nie wyczerpana
- [x] Commit Tury 13 (Sentry) do git — `0f4aff9`
- [x] Dorzucić `.cursorignore` (release/, dist/, dist-electron/, node_modules/, *.asar, *.exe)
- [x] Git cleanup — odtrackowano dist-electron/ i release/ z historii, .env dodany do .gitignore

### Supabase Pro (gdy będzie karta firmowa) — $25/mc — ⚠️ KONIECZNIE dla backupów bazy!
- [ ] Upgrade konta Supabase do Pro
- [ ] 30-dniowe backups + Point-in-Time Recovery (bez tego brak backupu danych!)
- [ ] 8 GB databasy + 250 GB transferu
- [ ] Decyzja: free quota Edge Functions vs Pro (raczej wystarcza)

### Monitoring podstawowy (FREE)
- [x] UptimeRobot — keyword monitor na Edge Function orders-intake (GET → {"status":"ok"})
- [x] Alert email gdy padnie
- [x] Drugi monitor (HTTP na Supabase URL) usunięty — zbędny, Edge Function i tak odpytuje bazę
- [ ] Public status page (opcjonalnie)

### Backup własny — ✅ DZIAŁA od 2026-09-07
- [x] `scripts/db-backup.ps1` — pg_dump (session pooler, portable PostgreSQL 18.1 z `C:\Users\User\Tools\pgsql`)
- [x] Harmonogram Windows: zadanie „KR Center DB Backup" codziennie 07:30 (+ start po włączeniu, gdy zaspał)
- [x] Rotacja: 30 dni dziennych + 12 miesięcznych → `%USERPROFILE%\KRCenter-Backups`
- [ ] Kopia poza komputerem (OneDrive/NAS) — folder KRCenter-Backups do synchronizacji
- [ ] Docelowo: przenieść backup na maszynę 24/7 u informatyka (skrypt gotowy do przekazania)

---

## 🟡 PRIORYTET 2 — Wczesne tygodnie po Sentry

### Auto-updater (Tura 13b) — ✅ W PEŁNI ZROBIONE
- [x] `electron-updater@6.8.3` zainstalowany
- [x] `electron-builder.json5` — sekcja `publish` z GitHub provider
- [x] `electron/main.ts` — `autoUpdater` pół-auto (autoDownload: false), IPC eventy + handlery
- [x] `src/components/UpdateBanner.tsx` — banner z progress barem, pobierz/restart/dismiss
- [x] `App.tsx` — `<UpdateBanner />` między headerem a main
- [x] `AppHeader.tsx` — przycisk "Sprawdź aktualizacje" w About modal
- [x] `npm run release` script (build + publish always)
- [x] GitHub Releases jako serwer aktualizacji — działa

### Tura 10.3 — UI managera dla API keys
- [x] Lista kluczy + statystyki (total_requests, total_orders_created, last_used_at)
- [x] Przycisk "Wygeneruj nowy klucz" (RPC generate_api_key w Supabase)
- [x] Przycisk "Dezaktywuj / Reaktywuj klucz"
- [x] Filter: aktywne / nieaktywne
- [x] Dostępne tylko dla managera (tabsForUserDepartment)

### Email notifications
- [ ] Supabase ma SMTP wbudowane — konfiguracja wyzwalaczy
- [ ] "Nowe zamówienie z konfiguratora wymaga weryfikacji" → email do managera
- [ ] "Stan magazynu poniżej ROP dla SKU X" → email do magazyniera
- [ ] "Zamówienie zaległe >5 dni w produkcji" → email do production lead
- [ ] In-app notifications (bell icon z licznikiem)

---

## 🟢 PRIORYTET 3 — Tygodnie 4-6

### Pierwsze testy E2E (Playwright)
- [ ] Setup Playwright + GitHub Actions runner
- [ ] 5 flow:
  - Logowanie + przywitanie
  - Dodanie nowego zamówienia (manual, każda kategoria: Bastion, Disting, STA, ST, DrzwiWewnetrzne)
  - Edycja istniejącego zamówienia
  - Generowanie PDF zamówienia do dostawcy
  - BOT order intake przez API + workflow Weryfikacji

### Migracja z Excela
- [ ] **Selektywna** (4-8h): 12 tygodni WZ + aktywne zamówienia
- [ ] **Pełna** (12-24h): cała historia z 4 plików xlsm
- [ ] Etapy:
  - Audit Excel-i (struktura, dziwne kolumny, daty, braki)
  - Mapping pól: Excel → tabela `orders`
  - Skrypt migracyjny z dry-run mode
  - Logowanie błędnych wierszy do CSV
  - Weryfikacja + cleanup
- [ ] Wymaga konsultacji z handlowcami

### Drukowanie ZPL
- [ ] Czeka na drukarkę (IP + port 9100)
- [ ] TCP socket connection
- [ ] ZPL template builder
- [ ] Test print + boundary cases
- [ ] **Etykieta z kodem QR** — QR ma zawierać `order_id` (unikalny w bazie; numery zleceń NIE są unikalne między Center/Profil/WZ)

### Skaner QR/barcode w mobilnej (PO drukarce/etykietach) — DECYZJE USTALONE
- [ ] Skaner przez `BarcodeDetector` API (natywny w Chrome Android, bez bibliotek) — fallback `@zxing/browser` na iOS jeśli brak
- [ ] Kod = `order_id` → jednoznaczne dopasowanie zlecenia
- [ ] Akcja 1: **Otwórz zlecenie w Pakowaniu** (skan zamiast wpisywania numeru → od razu zdjęcia/podgląd)
- [ ] Akcja 2: **Oznacz mój etap** jako zrobiony dla zeskanowanego zlecenia (jeśli pracownik ma przypisane stanowisko)
- [ ] Przycisk skanera w nagłówku mobilnym (ikona aparatu) — wspólny dla obu zakładek
- [ ] Blocker: wymaga fizycznych etykiet z QR na drzwiach (zależne od drukarki ZPL powyżej)

### CSS cleanup — Tura 12 (Forge Control Design System)
- [x] Tura 12.1 — Sidebar + Forge Control layout (sidebar nav, app-layout)
- [x] Tura 12.2 — Badge unifikacja (20+ klas → 5 wariantów + tokeny, radius 4px)
- [x] Tura 12.3 — Formularze unifikacja (input-tokeny, .form-input, .form-label, .form-field)
- [x] Tura 12.4 — Modale unifikacja (.modal-content/header/body/footer, animacja modalIn)
- [x] Tura 12.5 — Tabele unifikacja (--table-cell-padding token, .data-table base)
- [x] Tura 12.6 — Dead code cleanup (20 orphan comments usunięte)

---

## 🔵 PRIORYTET 4 — Miesiąc 2-3

### Autonomia — Tier 1 (łatwe wins)
- [ ] Self-healing background jobs (Supabase Cron):
  - Wykrywa stuck orders >7 dni
  - Wykrywa duplikaty (`airtable_id` z różnymi datami)
  - Sprawdza fikcyjne kategorie
  - Wysyła raport managerowi
- [ ] Onboarding tutorial — interactive tour przy pierwszym logowaniu
- [ ] Tooltips kontekstowe przy każdym polu (znak `?`)

### Code signing
- [ ] EV certificate ($200-400/rok, Sectigo/DigiCert/Comodo)
- [ ] Weryfikacja firmy (KR Center jako entity)
- [ ] Po podpisaniu: brak SmartScreen, brak false-positive Defender

### Dokumentacja
- [ ] **Użytkownika** — PDF (jak dodać zamówienie, jak naprawić błędne, etc.)
- [ ] **Techniczna** — README + /docs (architektura, setup dev env)
- [ ] **API docs** — dla developera konfiguratora (Tura 10.4)
- [ ] Screen recordings (krótkie 2-3 min filmy per scenariusz)

### CI/CD pipeline
- [ ] GitHub Actions
- [ ] Build na push do `main`
- [ ] Auto-upload setup.exe do Supabase Storage
- [ ] Notyfikacja Slack/email gdy build się sypie

### Konfigurator → bezpośrednio nasze API (Tura 10.4)
- [ ] Wymaga gotowości developera konfiguratora
- [ ] Wyłączenie Make.com
- [ ] Zmiana w kodzie konfiguratora (poza naszym repo)
- [ ] Dokumentacja API dla developera

---

## 🟣 PRIORYTET 5 — Miesiąc 4-6

### Autonomia — Tier 2
- [ ] Dynamiczne kategorie zamówień (z bazy zamiast hardcoded TABS)
  - Manager dodaje "Lux" → pojawia się zakładka bez kodu
- [ ] Smart suggestions / autocomplete:
  - Auto-fill na podstawie historii klienta
  - Auto-detect duplicate orders ("Wpisujesz 5 podobnych — batch mode?")

### Performance audit
- [ ] Czy listy z 5000+ zamówień zwalniają? (paginacja, virtualization)
- [ ] Indeksy w bazie (EXPLAIN ANALYZE na slow queries)
- [ ] React DevTools Profiler
- [x] Bundle size optimization (Vite chunk splitting — zrobione, osobne chunki)

### Real-time updates (Supabase Realtime)
- [ ] "Kolega Marek właśnie zmienił to zamówienie" w UI
- [ ] Live update list bez refresh
- [ ] Optimistic updates

### Mobile-friendly
- [ ] Responsive design dla małych ekranów
- [ ] Touch-friendly interactions
- [ ] PWA support? (Electron + mobile to inna historia)

---

## 🔮 PRIORYTET 6 — Wizja długoterminowa

### Autonomia — Tier 3 (większe projekty)
- [ ] Form builder — manager definiuje pola formularza w UI
- [ ] Workflow builder — manager definiuje etapy produkcji per kategoria
- [ ] AI admin — manager pisze "chcę X" → system generuje SQL/RPC z review

---

## 🔧 KOSMETYKA (niski priorytet, jak będzie czas)

- [ ] `.gitignore` cleanup (`.tmp-inter/`, sprawdzić co jeszcze)
- [x] Wyciszenie warning LF/CRLF (`git config core.safecrlf false`)
- [x] Vite chunk size warning — code splitting dla recharts, pdfmake (osobne chunki, limit 1500 kB)
- [x] Linter cleanup (0 errors / 0 warnings)
- [x] Dodanie strony "About" w aplikacji (wersja, autor, licencja — modal w AppHeader)

---

## 📊 KLUCZOWE METRYKI / DECYZJE

### Skala:
- 20-30 użytkowników jednocześnie
- ~3000 zamówień / miesiąc (~100 dziennie)
- 5 kategorii produkcyjnych: Bastion, Disting, STA, ST, DrzwiWewnetrzne

### Stack:
- Electron 30 + React 18 + TypeScript + Vite 5
- Supabase (Postgres + Edge Functions + Auth + Storage)
- pdfmake + Recharts + Lucide
- Sentry (error tracking + source maps)
- electron-builder (NSIS installer)
- git + remote GitHub `DaMesa97/kr-center-manager` (releases = serwer auto-update)

### Klucze techniczne (NIE w czacie!):
- Supabase project ref: `vwlabgmilckfhtuerzio`
- Edge Function URL: `https://vwlabgmilckfhtuerzio.supabase.co/functions/v1/orders-intake`
- API Key id=2 — produkcyjny "Konfigurator KR Center - prod"
- Webhook Make.com legacy: ukryty
- Sentry org: `kr-center`, project: `electron`

### Email userów:
- `{username}@krcenter.pl`

---

## 📝 KONWENCJE PRACY

- DRY all the way
- Każda zmiana → konkretny prompt dla Claude Code z dokładnymi instrukcjami plik po pliku
- SQL osobno (Claude Code/Cursor nie odpala) — user wkleja w Supabase SQL Editor
- Tury podzielone (np. 11.3.B.2, 11.3.B.3) żeby tool nie gubił kontekstu
- Bezpieczeństwo: API keys, tokeny, hasła NIGDY nie trafiają do czatu/Cursora — login przez terminal w OS
- **Git commit po każdej zamkniętej zmianie** (zasada nauczona po katastrofie Tury 11.3)
- Bezpośredni styl, polski + wulgarny koloryt (Tymek 28 lat, 5 lat w branży drzwiowej, KR Center)
---

## 🧪 DO PRZETESTOWANIA W FIRMIE (na sprzęcie, nie z domu)

### Etykiety — druk ZPL na Zebrze (Stage 2)
- Zakładka **Etykiety** (grupa Produkcja)
- Dodać drukarkę Zebra (nazwa + IP + port 9100)
- Dodać dokument ZPL (DoP) per kategoria (wklej ZPL / wgraj .zpl)
- Wydrukować N kopii → sprawdzić czy Zebra wypluwa etykietę (TCP 9100 raw)
- ⚠️ Wymaga restartu dev / rebuildu (zmiana w electron/main.ts — handler `label:printZpl`)

### Titan z konfiguratora
- Wysłać Titan (CORE/GUARD) z konfiguratora → czy `create_bot_order` daje kategorię STA i powstaje trójka STA+ST+Bastion

### Inne otwarte
- Bastion + stock: czy okuwanie ma zdejmować komponenty — po modelu rezerwacji do przeglądu: mapowanie `stage_key` w recepturach Bastiona (Tura 3 mapowała etapy STA/Disting)
- ~~„Moje stanowisko" dla Titan-Bastion~~ ✅ zrobione (noga Titan bez standardowych etapów Bastiona)
- Kopie backlogu Disting→STA (skrypt)
- Druk etykiet dynamicznych HTML (Stage 3) — w toku
- Multi-etykieta Bastion regulowana (główna + ~10 elementów) — później
- Partie produkcyjne regulowanych — naprawa, później
- ~~Supabase max_rows = 1000~~ ✅ obejście w kodzie (beta.31 — paginacja wszystkich dużych odczytów); podniesienie limitu w Supabase już niekrytyczne
- Martwy kod: wyłączona kolumna SKR w ST, nieużywane klasy CSS bastion-titan
- Przetestować pełny cykl rezerwacji na produkcji: rezerwacja → wydanie per etap → wymuszenie przy braku → inwentaryzacja prostująca minusy
- Zniszczenia: sprawdzić w praniu zgłoszenie z produkcji (zamiennik) vs z magazynu
