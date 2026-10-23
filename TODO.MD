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

## 🚦 PILOT STA — lista startowa (po stronie Tymka)

- [x] **Przypisania etapów pracownikom (23.10)** — STA obsadzone na wszystkich etapach: e1 DK · e2_1/e2_2 BP, MK, PP · e3 KS, KW · e4 BP, KW, PP, TC · e5 BP, DK, KS, KW, PP, TC. Titan: tylko ST titan_e2 (KS); Bastion (Titan) OKU/MON/PAK i Disting/Techniczne bez przypisań — uzupełnić, gdy te kategorie wejdą na apkę
- [ ] Przejrzeć 2 CSV z uzgadniania STA (23 niesparowane w apce → anuluj/zostaw; 15 otwartych tylko w arkuszu → potwierdź dosłanie)
- [ ] Inwentaryzacja otwarcia, magazyn po magazynie
- [ ] Wszystkie komputery na najnowszej becie → dać znać Claude: `min_app_version` + DROP starych kolumn (stage1–5/wpisał/release w orders i archiwum)
- [ ] Supabase panel: rejestracja (enable_signup) wyłączona
- [ ] Make: adres webhooka podsumowania Planu wydań (`app_config.route_plan_webhook_url`) + osobny klucz API dla importu z Excela
- [ ] Po zamknięciu czyszczenia STA: DROP tabel roboczych `migracja_arkusz_sta`, `migracja_sta_akcje`, `migracja_sta_backup` (Claude)

## 🧱 STOLARKA ALUMINIOWA — nowa kategoria (start 23.10)

Zlecenie = lista produkcyjna (LP) z AluronCAD, numer zlecenia = numer OF. Pozycje (konstrukcje) w `order_alu_positions`, etapy PER POZYCJA i PER SZTUKA (ilość 3 = 3 kliknięcia na etap). PDF-y (LP + lista cięcia LC) w storage `order-documents` → `order_documents`. Kategoria w bazie: `Aluminium`, zakładka „Stolarka aluminiowa”. Kod: `src/lib/aluLpParser.ts` (parser po współrzędnych, fixtures + testy), `src/lib/alu.ts`, `src/hooks/useAluOrders.ts`, `src/components/Alu*.tsx`, `migrate/aluminium_etap1.sql`.

- [x] **Etap 1 (23.10)**: zakładka + tabela zleceń, import LP (+LC jako komplet) z podglądem do poprawki, „istnieje → nadpisz / dodaj ponownie (OF… (2))”, szczegóły z pozycjami i PDF-ami, dopinanie listy cięcia do istniejącego zlecenia, nowa wersja LP z okna szczegółów. **Do sprawdzenia w aplikacji:** wgraj `LP_0003_10_2026.pdf` + `LC_0004_10_2026.pdf` naraz → podgląd (1 poz. drzwi AS75, 1090×2060, uwagi po ludzku) → Zapisz → zlecenie w tabeli, w szczegółach „Otwórz LP” / „Otwórz listę cięcia” (PDF w przeglądarce systemowej).
- [x] **Etap 2 — produkcja (23.10)**: etapy per pozycja i per SZTUKA na Moim stanowisku (komputer `ed6fd50` + telefon `d9b06f9`): zadanie = pozycja × etap, przycisk „✓ Sztuka k/q”, przepływ sztukowy (etap k tylko tyle razy, ile przepuścił k−1), kafelki osób, pasek „Cofnij” (RPC `mark_alu_position_stage` / `undo_alu_position_stage`, guard: kierownik albo pracownik z etapem alu w `worker_stages`), realtime `order_alu_positions`. Postęp zlecenia przepisuje trigger do `orders.extra_fields.alu.progress` → Wysyłka/Pulpit/mobile widzą % bez pozycji (`e4b5c45`). Wysyłka: dzień trasy alu = dzień tygodnia z terminu, realizacja montażem = grupa „Montaż własny” + chip MONTAŻ; wydanie jak inne (koniec obiegu). „Anuluj zlecenie” w szczegółach. Etapy alu przypisujesz w Użytkownikach → Etapy produkcji → sekcja „Stolarka aluminiowa”.
  **Do sprawdzenia:** (1) Użytkownicy → pracownik → Etapy → zaznacz np. Cięcie w „Stolarka aluminiowa”; (2) Moje stanowisko na jego koncie: karta `OF341/2026 · poz. 1`, „✓ Sztuka 1/1” → kafelek → toast → pasek „Cofnij” → cofnij; (3) to samo na telefonie; (4) drugi etap (okuwanie) nie da się kliknąć przed cięciem — komunikat po polsku; (5) w tabeli Aluminium pasek postępu rośnie; (6) Wysyłka: zlecenie w grupie PIĄTEK (termin 20.11 = pt), status „W produkcji” po pierwszym kliknięciu. Uwaga: każde kliknięcie sztuki to UPDATE zlecenia (postęp) → wpis w Audycie; jeśli szum przeszkadza, wyłączymy audyt dla tego pola.
- [x] **Etap 3 — ZM GLASS (23.10, częściowo)**: trzeci dokument zlecenia `kind='ZM'` — „+ Dodaj ZM GLASS” / „Otwórz ZM GLASS” w szczegółach, chip ZM w tabeli (`52ed56c`). Zamówienia szyb aluminium NIE idą przez zakładkę Szyby (plik generuje LiczOkno); szyby z LP zostają informacyjnie przy pozycji.
- [x] **ZM GLASS — rozpoznawanie po treści (23.10)**: okno importu rozpoznaje ZM (`ZAMÓWIENIE NR: ZM_GLASS …`), numer(y) OF z kolumny „Położenie szkła” (`OF270/2026:1:4`), dostawca, liczba szyb. Samo ZM → dopięcie do istniejących zleceń (jedno ZM z kilkoma OF → do każdego), ZM razem z LP → dopięte po zapisie. **Sprawdź:** przeciągnij `ZM_GLASS_0003_09_2026.pdf` (OF270/2026 musi istnieć) → „Dopnij”.
- [x] **Parser — kolejne LP (23.10)**: 3 LP + 3 LC + ZM jako fixture i testy. Naprawione: drugi układ bloku AluronCAD (bez „Poz.:”, „Kolor konstrukcji”, „Okucia i dodatki”, „Wymiar zewnętrzny konstrukcji: 2 360 mm x 2 590 mm” — wymiar ostateczny), opis z uwag (typ/otwieranie/kierunek), pozycje 2+ na stronach bez nagłówka, kilka ościeżnic → zewnętrzna (największa), kontrola S×W z m² pozycji (ostrzeżenie), szkło „1x5 szt” (= sztuki na konstrukcję), zawinięta nazwa szkła, klient bez końcówki terminu realizacji.
- [ ] **Parser — nadal brak przykładu**: OKNO (reguła wymiaru „szerokość wyżej na rysunku” nieprzetestowana), klient wielolinijkowy. Każdy nowy przypadek → fixture + test.
- [ ] ~~Import LP z maila przez Make → API~~ — Tymek 23.10: na razie NIE.
- [x] **Etykiety dla aluminium (23.10)**: JEDNA etykieta na SZTUKĘ pozycji (poz. z ilością 5 = 5 etykiet „1/5…5/5”), 100×150 jak STA. Szczegóły zlecenia alu → „🏷 Etykiety (N)” → wybór pozycji, podgląd, jeden wydruk wielostronicowy. Szablon „Aluminium — sztuka” w bazie (domyślny), edytowalny w Etykiety → Szablony → Aluminium; pola `{{alu_*}}` (sztuka, wymiar, typ, kolory, szkło, okucia, próg, termin, załadunek, realizacja). DoP nadal z LiczOkna. **Sprawdź:** wydruk testowy na drukarce etykiet.

## 🧪 DO SPRAWDZENIA — 23.10 wieczór (Claude, na `clean`, bez nowej bety)

- [ ] **Moje stanowisko — czekające schowane**: domyślnie widać tylko zadania gotowe do pracy + wszystko z X/XX (nawet niegotowe — towar na dziś/jutro). Przycisk „⏳ Pokaż czekające (N)” odsłania resztę, wybór zapamiętany na komputerze/telefonie (`stationShowWaiting`). Gdy nic nie jest gotowe — komunikat z przyciskiem zamiast pustej tabeli. Desktop + mobile.

- [ ] **Poprawki z przeglądu paczki 23.10** (3 skautów):
  - WYDANIE w tabelach tylko dla kierownika (było klikalne dla każdego → WZ schodziło z magazynu, a datę RLS odrzucał po cichu); zapis daty sprawdza, czy wiersz faktycznie się zmienił
  - „Zamów szyby” (Naświetla) tylko kierownik — wcześniej webhook szedł do szklarza, a stempel daty RLS odrzucał po cichu → ryzyko podwójnego zamówienia
  - Aluminium na desktopowym stanowisku: nowe zlecenie alu od razu pokazuje zadania (wcześniej dopiero po zmianie zakładki)
  - Pozycje alu na stanowisku (desktop + mobile) pobierane z paginacją — wcześniej >1000 wierszy ucinało po cichu
  - Import LP: porównanie z LC po numerze z pola (po ręcznej poprawce), przycisk ✕ odpina LC, wymiary > 0 i ilość całkowita, walidacja także przy „Nadpisz”/„Dodaj ponownie”, pytanie przy kilku zleceniach o tym numerze (dopinanie samej LC); w bazie CHECK wymiarów > 0
  - pdfjs: druk DoP i import LP/LC idą po kolei (wspólny worker — równoczesna operacja zrywała drugą)
  - **Sprawdź:** import LP z poprawką numeru OF; druk partii deklaracji (czy dalej śmiga)

### 🟡 Drobnica z przeglądu 23.10 (nie ruszane)
- [ ] Alu: „Cofnij” sztuki zdejmuje zawsze OSTATNI inicjał (przy dwóch stanowiskach może zdjąć cudzy) — ważne, gdy inicjały sztuk zaczniemy pokazywać
- [x] Alu: zmniejszenie ilości pozycji po częściowym oznaczeniu → pierwszy „Cofnij” bez widocznego efektu — ZROBIONE 23.10: trigger w bazie przycina odklikane sztuki przy każdym zmniejszeniu ilości (`migrate/aluminium_przyciecie_ilosci.sql`, test z rollbackiem)
- [ ] Alu: trigger postępu może chwilowo zaniżyć licznik o 1 przy równoczesnych kliknięciach dwóch pozycji (sam się naprawia)
- [ ] Alu: każda sztuka = UPDATE zlecenia → pełny refetch pozycji w tabeli Aluminium (rozrzutne przy pracującej hali) + wpis w Audycie
- [x] Alu: termin w weekend — ZROBIONE 23.10: import blokuje termin w sobotę/niedzielę (pod datą widać dzień tygodnia), domyślny +4 tyg. z weekendu → poniedziałek; załadunek dalej = dzień roboczy przed trasą (pn → pt)
- [x] Wzmianki @ — ZROBIONE 23.10: powiadomienie tylko dla komentarza, który autor naprawdę dodał na zleceniu (ta sama treść)
- [x] Mobile i appAlert loguje oryginał błędu do konsoli — ZROBIONE 23.10 (`humanizeAndLog`)
- [x] Okna potwierdzeń: Tab krąży między przyciskami okna — ZROBIONE 23.10. (Zostaje: przy dwóch oknach naraz Esc zamyka to pod spodem — rzadkie)
- [x] `merge_order_extra_fields` rzuca błąd przy odmowie RLS / braku zlecenia — ZROBIONE 23.10 (`migrate/drobnica_przegladu_23_10.sql`)
- [x] glass-order-webhook (v2) sprawdza rolę kierownika — ZROBIONE 23.10
- [x] Postęp par Disting Plus liczy etapy partnera z lustra (dist_*/sta_*) — ZROBIONE 23.10 + dopisane 4 lustra sta_e3 z uzgadniania

### ❓ Do przemyślenia (Tymek)
- [x] **Okna potwierdzeń** — DECYZJA 23.10: Enter potwierdza POZYTYWNE okna (wydanie, odebrane, zrealizowana, zweryfikowane — zielony przycisk), przy usuwaniu/anulowaniu/cofaniu/„mimo to” fokus dalej na „Anuluj”. Rodzaj okna z treści: `lib/confirmTone.ts`
- [x] **Wysyłka: PILNE vs X/XX** — DECYZJA 23.10: na razie tylko PILNE. Plan wydań X/XX schowany przełącznikiem `ROUTE_PLAN_ENABLED = false` (constants.ts): znika z Wysyłki, chipy i kolejność na stanowiskach; dane `extra_fields.route_mark` zostają, cron `route-plan-summary-daily` wstrzymany (`cron.alter_job(4, active := true)` przy powrocie)
- [ ] ~~Wysyłka: PILNE vs X/XX~~ (stary opis poniżej) — dwa niezależne znaczniki pilności (PILNE w kolejności i Plan wydań X/XX) to trochę z dupy. Do decyzji, czy scalić / jak je rozdzielić znaczeniowo.

## 🧪 DO SPRAWDZENIA — 23.10 (punkt 3 z audytów, na `clean`, bez nowej bety)

SQL wgrany po teście w transakcji z ROLLBACK; Edge Function `dynamic-handler` v24 wdrożona. W aplikacji nic nie było przeklikane.

- [ ] **Aktualizacja bez trwałej blokady**: błąd pobierania pokazuje „Aktualizacja się nie udała” z „Spróbuj ponownie” / „Pracuj na obecnej wersji”; pobieranie bez postępu 60 s = błąd. Admin przechodzi przez `min_app_version` (czerwony pasek zamiast blokady) — `949d6bc`
- [ ] **Podwalina z konfiguratora**: pole „Podwalina” w formularzu STA/Disting (np. „Podwalina 100 mm ×1”), w szczegółach ościeżnicy i pakowania na stanowisku, na etykiecie `{{podwalina}}`; uzupełnione 43 zlecenia — `dfc0bb2`
- [ ] **Uwagi „-” / „undefined”** z bota i Excela → puste (bot w bazie, Excel w dynamic-handler v24). UWAGA: czyszczenie zamieniło też puste uwagi '' na NULL w 3634 zleceniach z Excela (w aplikacji bez różnicy, w Audycie widać zmiany) — `dfc0bb2`, `528be2e`
- [ ] **Wzmianki @ w komentarzach** znowu dają powiadomienie w dzwonku (nie działały od lipca — RLS po cichu odrzucał) — `ca20809`
- [ ] **Logowanie na telefonie**: 5 złych haseł → blokada 15 min jak na komputerze — `3767fa0`
- [ ] **„Możliwy duplikat” dla firm z aliasem** (bot: ta sama firma + nr klienta) — `bc46afe`
- [ ] **Limit klucza API** 60 → 600/min (paczki z Excela dostawały 429 i przepadały) — `9cc9f19`
- [ ] **Etapy pracownika**: błąd wczytania blokuje zapis, błąd zapisu widoczny — `1b99b2d`
- [ ] **Bastion — kolor WF** (strona wewn.) pod kolorem w tabeli, na stanowisku, pola etykiety `{{kolor_wf}}` / `{{kolor_oscieznicy_wf}}` (70 zleceń) — `51c9572`
- [ ] **Okna potwierdzeń**: Enter = przycisk z fokusem (przy usuwaniu domyślnie „Anuluj”!), Esc zamyka tylko to okno, Esc zamyka komunikat OK — `c0c5be5`
- [ ] **Uprawnienia w bazie = aplikacja**: zakładanie zleceń tylko kierownicy; edycja kierownicy + magazynier tylko drzwi wewnętrzne („✓ Wydane”); `app_config` zapis tylko admin — `d128665`
- [ ] **(22) błędy po ludzku + (23) profil** — `fbafe6e`, `32c963b`

## 🧪 DO SPRAWDZENIA W DOMU — przegląd 22.10 (wszystko na `clean`, bez nowej bety)

Zrobione 22.10 (Claude). Typecheck i lint czyste, 259 testów zielonych. SQL wgrany do bazy po teście w transakcji z ROLLBACK.
W aplikacji NIC nie było przeklikane — odhacz po sprawdzeniu:

**Formularz zamówienia**
- [ ] Edycja ST z bota NIE kasuje koloru ościeżnicy / panelu (wcześniej każda poprawka kasowała: 194 zleceń z kolorem, 105 z panelem). To samo Techniczne (INFO, przedłużenie) i Bastion (klamka) — `6070f8f`
- [ ] Zamknięcie formularza BEZ zmian nie pyta o niezapisane dane (ST/Bastion pytały zawsze); po zmianie dowolnego pola pyta — `0d2f334`
- [ ] Enter w polu formularza NIE zapisuje zamówienia (tylko przycisk) — `e91e95b`
- [ ] Titan: edycja STA/ST zmienia też nogę Bastion (wymiar/kolor) — `6070f8f`
- [ ] Filtr „Wykonawca” wybrany w STA nie chowa zleceń w innych zakładkach (było Techniczne 0/589) — `7ce46c0`
- [ ] Szkic komentarza nie przechodzi na następne zamówienie — `79fce97`
- [ ] Tabele zamówień / reklamacji / szyb: MODEL z systemem pod spodem (kolumna SYSTEM zniknęła) — `de4ca24`, `fda7056`

**Magazyn**
- [ ] Zapis / usunięcie / wyłączenie receptury → komunikat „Przeliczono rezerwacje N zleceń” (zlecenia z wydanym towarem pominięte) — `7b0e0a2`
- [ ] Dobieranie receptur ~35× szybsze → zapis zlecenia powinien być wyraźnie szybszy
- [ ] UWAGA dane: jednorazowo przeliczone rezerwacje wszystkich kategorii — Disting ma teraz rezerwacje na wszystkich zleceniach, więc w Alertach dużo więcej braków (dane testowe)
- [ ] Przesunięcie MM z brakiem → okno z listą braków i „Przesuń mimo to” (nie blokuje) — `f5bd7fa`
- [ ] Archiwizacja nie wywraca się na zleceniach z ruchami magazynowymi; komentarze i pozycje drzwi wewn. NIE są już kasowane przy archiwizacji; historia ruchów pokazuje nr zlecenia po archiwizacji — `9187205`

**Hala / mobile**
- [ ] „Ilość” w szczegółach każdego etapu (desktop + telefon) — `bc092f5`
- [ ] Pasek „Cofnij” przez 60 s po oznaczeniu etapu (desktop + telefon) — cofa etap, zwraca wydany towar (ZWR), czyści lustro u partnera
- [ ] Telefon bez internetu: komunikat + „Spróbuj ponownie” zamiast „Brak zadań 🎉”; większe przyciski; pracownik produkcji startuje w „Moje zadania”
- [ ] Stanowisko (desktop i telefon) pobiera tylko zlecenia z kategorii pracownika — zadania mają być te same co wcześniej (sprawdzić na koncie z etapami)
- [ ] Duchy: 21 starych zleceń Disting z migracji (2024–2026) zamknięte bez wydania, rezerwacje zdjęte — nie ma ich już na górze stanowiska — `a36cb9b`

**Uprawnienia**
- [ ] Klucze API widzi/zmienia tylko admin (aplikacja + RLS) — kierownik działu nie widzi — `b9dac19`
- [ ] „+ Nowe zamówienie” tylko dla kierowników (także drzwi wewnętrzne — jeśli magazyn je zakłada, przywrócić) — `97c7d5b`

**Wcześniej (21.10, beta.55): stanowisko, logowanie, magazyn/inwentaryzacja** — opis w historii gita (`ae435f1`, `cebbd16`, commit magazynu przed `c0fefff`)

### ❓ Czeka na decyzję (22.10)
- [x] **Webhook szyb przy tworzeniu zlecenia** — DECYZJA (22.10 wieczór): WYŁĄCZONE. Szyby zamawiane wyłącznie świadomie z zakładki Szyby (PDF/przycisk z potwierdzeniem). Auto-wysyłka przy zapisie STA/pary usunięta z useOrders
- [x] **(21) `revalidate_bot_order` kasuje „MOŻLIWY DUPLIKAT”** — NAPRAWIONE (migracja revalidate_zachowuje_duplikat_fix): ostrzeżenia zawierające „duplikat” są zachowywane przy przeliczaniu; przetestowane w transakcji z rollbackiem
- [x] **(22) Surowe błędy z bazy** — ZROBIONE 23.10: `lib/friendlyError.ts` tłumaczy typowe błędy Postgresa/sieci (duplikat, FK, brak uprawnień/RLS, brak pola, timeout, brak internetu, sesja…) w KAŻDYM toaście błędu, na telefonie i w appAlert — prefiks i polska dalsza część komunikatu zostają, oryginał w konsoli. Dymek błędu 10 s (inne 3,5 s) i NAD oknami (z-index). **Sprawdź:** np. zapis bez internetu → „brak połączenia z serwerem”
- [x] **(23) Profil się nie wczytał** — ZROBIONE 23.10: zamiast zastępczego profilu z pustą rolą ekran „Nie wczytano profilu” (Spróbuj ponownie / Wyloguj); jeśli profil był już wczytany, a padło tylko odświeżenie — zostaje stary. **Sprawdź:** wyłącz internet tuż po zalogowaniu (trudne do odtworzenia — wystarczy, że normalne logowanie działa)

## 🟠 ODŁOŻONE Z PRZEGLĄDU (2026-10-22)

- [ ] **Szablon etykiety Disting** (id 4): wiersz „Szklenie dostawki” używa `{{naswietle_szkl}}` zamiast pola dostawki (`dostawka_szkl`) — poprawić w edytorze szablonów
- [ ] **Zgłoszenie #60 — łącznik naświetla** („ŁĄCZNIK NAROŻNY NIERDZEWNY NAŚWIETLA 68AC MAŁY”) siedzi w bazowych recepturach okuć STA #2 i #14 (kryterium tylko system) → rezerwuje się we wszystkich drzwiach STA, także bez naświetla. Ustalić z Dawidem: przenieść do receptury z kryterium „jest naświetle”
- [ ] **Receptury do posprzątania**: receptura 55 pusta (0 komponentów), a wygrywa dobór; receptury 520 i 522 mają identyczne kryteria (duplikat)
- [ ] **Disting — próg bez magazynu**: brak `warehouse_assignment` dla part=prog (to samo sprawdzić dla ST: prog / dostawka / naświetle)
- [ ] **Migracja przed startem**: zakończone zlecenia z Excela MUSZĄ przyjść z datą wydania — inaczej wiszą jako otwarte „duchy” na górze stanowisk i rezerwują magazyn (22.10 zamknięto ręcznie 21 takich z `source='migracja'`, `migrate/duchy_migracji_zamkniecie.sql`)
- [ ] **Osobny klucz API dla Excela** (Ty, w Make): teraz konfigurator i import z Excela jadą na JEDNYM kluczu „Konfigurator - prod” — paczka z Excela (19.10: 224 żądań/min, 268 odrzuconych 429) blokowała też konfigurator. 23.10 limit podniesiony 60 → 600/min (`migrate/limit_klucza_api_600.sql`). Docelowo: admin zakłada w „Klucze API” klucz „Excel”, Ty podmieniasz go w scenariuszu Make importu Excela

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
