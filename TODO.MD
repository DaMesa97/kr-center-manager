# KR Center App — TODO Roadmap

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

### Supabase Pro (gdy będzie karta firmowa) — $25/mc
- [ ] Upgrade konta Supabase do Pro
- [ ] 30-dniowe backups + Point-in-Time Recovery
- [ ] 8 GB databasy + 250 GB transferu
- [ ] Decyzja: free quota Edge Functions vs Pro (raczej wystarcza)

### Monitoring podstawowy (FREE)
- [x] UptimeRobot — ping co 5 min na Supabase URL + Edge Function
- [x] Alert email gdy padnie
- [ ] Public status page (opcjonalnie)

### Backup własny
- [ ] Script Node/Python pg_dump → Supabase Storage (gdy Pro)
- [ ] Cron co dziennie
- [ ] Rotacja: 30 dni dziennych + 12 miesięcznych

---

## 🟡 PRIORYTET 2 — Wczesne tygodnie po Sentry

### Auto-updater (Tura 13b) — ✅ ZROBIONE (GitHub Releases, bez Supabase Pro)
- [x] `electron-updater@6.8.3` zainstalowany
- [x] `electron-builder.json5` — sekcja `publish` z GitHub provider (owner/repo do uzupełnienia)
- [x] `electron/main.ts` — `autoUpdater` pół-auto (autoDownload: false), IPC eventy + handlery
- [x] `src/components/UpdateBanner.tsx` — banner z progress barem, pobierz/restart/dismiss
- [x] `App.tsx` — `<UpdateBanner />` między headerem a main
- [x] `AppHeader.tsx` — przycisk "Sprawdź aktualizacje" w About modal
- [x] `npm run release` script (build + publish always)
- [x] Wersja bumped: `1.0.0-beta.1` → `1.0.0-beta.2`
- [ ] **TODO user**: `npm run release` wymaga GH_TOKEN w `.env` + ustawienia owner/repo w `electron-builder.json5`

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
- git (local repo, brak remote jeszcze)

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