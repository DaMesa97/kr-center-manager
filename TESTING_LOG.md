# TESTING_LOG — sesja testów KR Center (start 27.11.2026, ok. 20:30)

> **Rano — sprzątanie danych testowych (TEST_):** w Supabase → SQL Editor wklej całą zawartość pliku `scripts/cleanup-test-data.sql` i kliknij Run. Skrypt usuwa tylko rekordy z prefiksem `TEST_` (zlecenia, komponenty, reklamacje, ruchy, rezerwacje, dokumenty) i na końcu sprawdza, że nic `TEST_` nie zostało (inaczej zgłasza błąd i nic nie zmienia). Można go uruchamiać wielokrotnie.
> Testy wydajności w nocy idą w transakcjach cofanych na końcu — nie zostawiają danych.
>
> **Decyzje do podjęcia:** `DECISIONS.md` (podsumowanie na górze). **Branch nocny:** `night-testing-2026-11-27`.


## 0. Przygotowanie

### Co się zmieniło w ostatnich 7 dniach (153 commity, 18.11–27.11; 49 z nich 27.11)
- **CRM Po Drzwi** (największy obszar): nowy wygląd v3 wg makiet (Do zrobienia, karta klienta z etapami, oferta z „Poproś o zmianę”), wynik klienta (zamówił / przegrany), ceny z cennika KR Center w ofercie z montażem, NIP z GUS / wykazu VAT, umowa i protokół z danymi firmy, załączniki maili, zamówienia sklepowe z BaseLinkera (`crm.zamowienia_sklep`).
- **Drzwi wewnętrzne**: import RO z Optimy, komplety przesuwne, odhaczanie pozycji przy pakowaniu (telefon i komputer), dwa magazyny WEW1 / WEW2, kartka do spisu i stany „jak w Excelu”, statystyki sprzedaży po grupach modelowych.
- **Wysyłki kurierem (SUUS)**: nowy ekran, palety, przesyłka zakładana w BaseLinkerze (Edge `crm-bl-sync`).
- **Magazyn**: WZ reklamacyjne, receptury „Inne” (wszystkie pasujące), minimum logistyczne, licznik alertów z pamięcią.
- **Wydajność (beta.169)**: lista zleceń ładuje tylko niewydane, indeksy, Wysyłka stronicowana.
- **27.11 wieczorem**: pierwsza seria testów 6 agentów (`OneDrive/automatyzacja ofert/TESTY_AGENTOW_27-11.md`) i 6 commitów poprawek (939c7fc…e23d46a, przyszła 1.1.8); druga seria agentów w toku.

### Stan narzędzi na starcie
| Sprawdzenie | Wynik |
|---|---|
| `npx tsc --noEmit` | OK (0 błędów) |
| `npm run lint` | **66 problemów (44 błędy, 22 ostrzeżenia)** — wszystkie sprzed sesji: `react-hooks/exhaustive-deps` 21, `no-explicit-any` 15, `no-unused-vars` 14, reszta drobne; najwięcej w `src/App.tsx` (16), `supabase/functions/orders-intake` (13), `orders-excel-intake` (13) |
| `npx vitest run` | OK — 79 plików, 646 testów |
| Docker (lokalna baza Supabase) | niedostępny |

### Snapshot stanów
`testing/snapshot-2026-11-27T1930Z.json` (poza gitem): 872 wiersze `warehouse_stock` (suma 34 289,05; rezerwacje 13 687,8; hash), `stock_reservations` per status (+ hash), liczniki ruchów, zleceń, wysyłek, WZR, odhaczeń, CRM, reklamacji.

### ⚠️ Baza NIE jest testowa
Instrukcja sesji zakłada bazę testową. Projekt Supabase `vwlabgmilckfhtuerzio` to **produkcja** obu firm (KR Center i CRM Po Drzwi): ~23,7 tys. prawdziwych zleceń, stany magazynowe, klienci CRM; triggery wołają BaseLinker, Optimę, pocztę i AI. Seed z `TEST_`, klikanie i skrypt czyszczący zmieniałyby dane firmy w trakcie normalnej pracy, a porównanie ze snapshotem i tak nie wyjdzie (ludzie pracują). Do decyzji właściciela, jak testować (patrz „Do decyzji”, pkt 1). Do tego czasu: tryb bezpieczny — odczyt + symulacje w transakcjach cofanych na końcu, poprawki jako lokalne commity, zmiany schematu tylko jako pliki migracji (nie wgrywane na produkcję bez zgody).

## Rundy

### Decyzja właściciela o trybie (27.11, ok. 21:30)
„Ludzie nie pracują na tej aplikacji na razie, możesz śmiało zakładać i potem kasować.” → dane testowe wolno zakładać i kasować (prefiks `TEST_`). Wyjątki, których i tak nie robię, bo nie da się ich cofnąć skryptem: prawdziwe przesyłki w BaseLinkerze, maile do klientów, zapisy w Optimie (triggery i funkcje Edge, które tam piszą). Zmiany schematu: regresje z dzisiejszych poprawek wgrywam od razu (przywracają zamierzone działanie); nowe poprawki bazy zostają jako pliki w `supabase/migrations/` do wdrożenia po decyzji (lista na końcu).

## Runda 1 (27.11 wieczorem) — druga seria 6 testerów + recenzent poprawek

Źródło: raporty 6 agentów (recenzent poprawek, hala STA/Disting/ST, reklamacje, zaopatrzenie, wejście zleceń, CRM backend). Kroki odtworzenia i dowody są w raportach; tu skrót.

### Poprawione w tej rundzie
| # | Waga | Rola / obszar | Problem | Poprawka | Commit |
|---|---|---|---|---|---|
| 1 | KRYTYCZNY | CRM (regresja 46f3387) | crm-mail-sent v17 nie oznaczał żadnej oferty sklepowej jako wysłanej (`brutto` null, kwota w `cena_razem`) | `brutto ?? cena_razem`; v18 wgrana i porównana z repo | 068f1c5 |
| 2 | WYSOKI | CRM (regresja 46f3387) | kilka maili jednego dnia przesuwało „Zapytaj o decyzję” i kasowało szkic; „5 dni roboczych” liczone jako kalendarzowe | follow_up z ostatnich 24 h bez zmian; kolejne za tydzień (v18) | 068f1c5 |
| 3 | WYSOKI | CRM (regresja 46f3387) | trigger `leady_bez_decyzji_po_wyniku` cofał zadanie po ofercie wysłanej z Outlooka klientowi „Zamówił” | przepuszcza zmianę z triggera (`pg_trigger_depth() > 1`); test z rollbackiem; **wgrane** | 42cdb9e |
| 4 | WYSOKI | Reklamacje (regresja 5a497ed) | „Szukaj wydanych” szukało we wszystkich kategoriach (zła para Disting Plus, obce zlecenia) | filtr po kategorii zakładki | 94c3180 |
| 5 | WYSOKI | Zlecenia (regresja 5a497ed) | powrót „Ukryj wydane” po Ctrl+K i tak ładował całą kategorię (stary ref) | setter ustawia ref od razu | 7a5a638 |
| 6 | WYSOKI | Wysyłki (regresja cdc16d2) | „Anuluj” na wysyłce nadanej w międzyczasie odpinał zlecenia (groźba drugiej wysyłki) | `.select('id')` i przerwanie, gdy 0 wierszy | 8ba6391 |
| 7 | ŚREDNI | Wysyłki | liczba w zakładce „Do wysyłki” skakała przy wpisywaniu | liczona bez filtra szukania | 8ba6391 |
| 8 | ŚREDNI | CRM (regresja 46f3387) | NIP wklejony jako „NIP 774-…” blokował zapis klienta | ucinanie przedrostka „NIP”, test | a58b963 |
| 9 | ŚREDNI | Zlecenia (regresja 5a497ed) | „Wyświetlane: 600 z 330” przy pokazanych anulowanych; partie Bastion ponawiały te same zapytania | licznik zgodny z filtrem; zapamiętane id | dcfade5 |
| 10 | ŚREDNI | Drzwi wew. (regresja 3eb8537) | ponowne odhaczenie zmienionej linii pokazywało godzinę poprzedniej osoby | `picked_at` przy upsercie | c7b8e42 |
| 11 | WYSOKI | Zaopatrzenie | pozycje ZD ładowane bez stronicowania (po 1000 znikną najnowsze) | `fetchAllPages` | 1215ed2 |
| 12 | ŚREDNI | Zaopatrzenie | PDF ZD bez miejsca dostawy | „Miejsce dostawy: <magazyn>” | cd88061 |

Po każdej poprawce: `tsc` OK, testy modułu OK.

### Znalezione, jeszcze nie poprawione (kolejne rundy albo „Do decyzji”)
**Krytyczne**
- Reklamacje: `sync_complaints_from_excel` nadpisuje cały zestaw etapów reklamacji — kliknięcia z programu znikają co 15 min (ST/Disting/Bastion).
- CRM: `crm.polacz_leady` pada na dwóch etykietach z jednej grupy (2 z 5 par duplikatów) i gubi zamówienia sklepowe (`lead_id` → NULL) oraz dane firmy/NIP klienta źródłowego.
- CRM: mail od klienta, który już dzwonił (numer w podpisie należy do innego klienta), zakłada drugiego klienta (`crm-call-ingest/mail.ts`) — 3 pary w 7 dni.
- CRM: umowę da się zrobić z oferty z pozycjami po 0 zł (oferta 2026/11/005, wysłana starą pocztą v16).
- Hala: Disting Plus — rezerwacje części skrzydła (e3/e4) leżą na rekordzie Disting, a etap odhacza STA → nikt ich nie wydaje (2568 rezerwacji, 7389 szt.) — **wymaga decyzji**.
- Zaopatrzenie: Stany i Alerty liczą minimum całej firmy osobno na każdym magazynie; ujemne stany wchodzą do sugestii 1:1; trzy ekrany dają trzy różne „ile zamówić” — **wymaga decyzji** (jedna reguła).
- Wejście zleceń: „ANULOWANE” wpisane w kolumnie etapu Excela nie anuluje zlecenia (7 zleceń, 65 rezerwacji).
- Wejście zleceń: RO drzwi wewnętrznych z MR Profil zderzą się numerem z KR (`orders_unique_number_per_category_new`) — **decyzja** (przedrostek).

**Wysokie** (wybór): numer reklamacji może się powtórzyć (`max+1`); para Disting Plus zapisywana w trzech krokach; filtry nad listą reklamacji nic nie robią; WZR nie podpina reklamacji Disting Plus; cofnięcie etapu na wydanym zleceniu zostawia rezerwację; baza pozwala odhaczać nie swoje etapy (sprawdza tylko kategorię); „Cofnij” kafelka kolegi na wspólnym telefonie; łącznik naświetla w recepturze bazowej; 7 zdublowanych numerów reklamacji w Excelu nadpisuje się co 15 min (~600 zapisów/dobę); numer umowy zużywa się przy nieudanej próbie; nocne porządki CRM oznaczają przegranego mimo zadania w przyszłości; VAT 8% w umowie przy niepełnych danych; Weryfikacja zalana (462 pozycje, 1074 powiadomienia/tydzień); „Ponów do Optimy” bez adresu webhooka; ponowne wysłanie z konfiguratora zostawia stare zlecenie z rezerwacjami; SYSTEM PRZESUWNY pomijany w imporcie Optimy (brak `interior_type`); Titan — części utykają otwarte; ~80 otwartych zleceń bez wiersza w Excelu; RO usunięte w Optimie nie zamyka zlecenia; ZD anulowane po częściowym przyjęciu ma status „Anulowane”; Smart ROP napompowany jednorazowym nadrobieniem z 24.11.

**Podsumowanie rundy 1:** znalezisk ok. 70 (krytyczne 8, wysokie ok. 25, średnie ok. 20, niskie ok. 15); poprawione 12 (w tym 9 regresji z dzisiejszych poprawek).


## Runda 2 (27.11, ok. 22:30–23:30) — poprawki znalezisk z rundy 1, które nie wymagają decyzji

Zmiany bazy sprawdzane w transakcjach cofanych na końcu (wynik w komunikacie wyjątku), zapisane jako pliki migracji i **niewgrane**. Funkcje Edge poprawione w repo i **niewgrane** (na serwerze zostają obecne wersje).

| # | Waga | Rola / obszar | Problem | Poprawka | Wdrożenie | Commit |
|---|---|---|---|---|---|---|
| 13 | ŚREDNI | Reklamacje | pole Szukaj i „Ukryj wydane” nad listą reklamacji nic nie robiły | filtr po numerze, zleceniu, firmie, powodzie, modelu; „Ukryj wydane” chowa zrealizowane (zmiana widoku domyślnego: zrealizowane schowane, jak przy zleceniach) | aplikacja | fdb11bb |
| 14 | WYSOKI | Magazyn | WZ reklamacyjny nie podpinał reklamacji Disting Plus („kilka pasuje”) | para wzajemnie połączona → wiersz STA | aplikacja | 9230e24 |
| 15 | KRYTYCZNY | Reklamacje | synchronizacja z Excelem kasowała etapy reklamacji kliknięte w programie | scalanie: Excel uzupełnia, program wygrywa | migracja `20261127223000_reklamacje_excel_scalanie_etapow.sql` | 4b4f1eb |
| 16 | KRYTYCZNY | CRM | łączenie klientów padało na etykietach z jednej grupy, gubiło zamówienia sklepowe i dane firmy | etykieta celu wygrywa w grupie „jedna na grupę”; `zamowienia_sklep` i NIP/firma przechodzą | migracja `20261127224000_crm_polacz_leady_etykiety_zamowienia_firma.sql` | 9b57535 |
| 17 | WYSOKI | CRM | nocne porządki zamykały jako przegranego klienta z zadaniem w przyszłości | pomija klientów z zadaniem na dziś lub później | migracja `20261127225000_crm_porzadki_bez_przyszlych_zadan.sql` | 1e362ef |
| 18 | WYSOKI | Produkcja | cofnięcie etapu na wydanym zleceniu zostawiało rezerwację na zawsze | odmowa P0409 „najpierw cofnij wydanie” | migracja `20261127230000_cofanie_etapu_na_wydanym.sql` | c4f5daa |
| 19 | ŚREDNI | Zaopatrzenie | ZD anulowane po częściowym przyjęciu miało status „Anulowane” | pozycje z przyjęciem i ZD → „completed” | migracja `20261127231000_zd_anulowanie_po_czesciowym_przyjeciu.sql` | 29f7662 |
| 20 | KRYTYCZNY | CRM | umowa z oferty z pozycjami po 0 zł; numer umowy zużywany przy nieudanej próbie; druga umowa z tej samej oferty = nowy numer | odmowa przy 0 zł (poza gratis), braki klienta przed numerem, ten sam numer dla tej samej oferty | Edge `crm-dokumenty` (repo) | 16de60e |
| 21 | ŚREDNI | CRM | przycisk „Umowa” aktywny dla oferty z cenami 0 zł | blokada z podpowiedzią, test | aplikacja | 72c3a22 |
| 22 | KRYTYCZNY | CRM | mail od klienta, który już dzwonił (numer w podpisie), zakładał drugiego klienta; sklejone numery z podpisu | dopięcie do klienta z tym numerem (+ adres do `inne_kontakty`); z kilku numerów pierwszy, > 15 cyfr odrzucane | Edge `crm-call-ingest` (repo) | f4d77d1 |
| 23 | KRYTYCZNY | Wejście zleceń | „ANULOWANE” w kolumnie etapu Excela nie anulowało zlecenia (65 rezerwacji) | wiersz idzie jako „ANULOWANE (kolumna …)” → lista „Anulowane w Excelu” w Weryfikacji | Edge `excel-sync` (repo) | 7409ce5 |

Stan po rundzie: `tsc` OK, **648 testów** OK, lint 66 problemów (bez zmian względem startu — wszystkie stare).

**Podsumowanie rundy 2:** poprawione 11 (krytyczne 5, wysokie 3, średnie 3). Nowych znalezisk w tej rundzie: 0 (runda poprawek). Zostają znaleziska z rundy 1 wymagające decyzji (sekcja „Do decyzji”) i większe tematy.

## Runda 3 (27.11, ok. 23:30 – 28.11 w nocy) — 6 testerów (hala/importy, prezes, biuro i nowy użytkownik, złośliwy i pechowy użytkownik, recenzent poprawek z rund 1–2) + 3 tory naprawcze

Testerzy tylko czytali kod i bazę; akcje symulowali w transakcjach cofanych na końcu. Poprawki: aplikacja (gałąź `clean`), migracje bazy jako pliki (**niewgrane**), funkcje Edge w repo (**niewgrane**). Tory naprawcze pracowały w osobnych kopiach (`git worktree`: `r3-baza`, `r3-edge`, `r3-formularze`), commity przeniesione do `clean` (cherry-pick).

### Znalezione
Ok. 60 znalezisk: krytyczne 4 (Anuluj→Przywróć podwaja rezerwacje — 223 otwarte zlecenia; edycja anulowanego zlecenia zakłada rezerwacje; „Nadpisz” w imporcie LP przesuwa termin i zmienia montaż na wysyłkę; czas realizacji ST/Bastion/Disting z dat wpisanych „na oko”), wysokie ok. 15, średnie ok. 25, niskie ok. 15. W tym 9 uwag recenzenta do poprawek z rund 1–2 (regresje / poprawki niepełne).

### Poprawione — aplikacja
| Waga | Obszar | Problem | Commit |
|---|---|---|---|
| KRYTYCZNY | Alu | „Nadpisz” nowej wersji LP brał termin +4 tyg. i „wysyłkę” z pustego okna; stary panel „już jest” zostawał po wczytaniu innego LP; uszkodzony PDF przerywał resztę | a5cd78e |
| WYSOKI | Magazyn | podwójne „Zapisz” w WZ reklamacyjnym i MM = dwa dokumenty i podwójne zdjęcie stanu | 944bf23 |
| ŚREDNI | Szukanie | Ctrl+K i kontrola duplikatu e-maila w CRM nie działały z przecinkiem (PGRST100 → „Brak wyników”), 414 przy długiej frazie | 942bfb4 |
| WYSOKI | Wszystkie zapisy | zerwane połączenie po udanym zapisie = „brak połączenia” → ponowienie = drugi dokument; komunikat mówi teraz „mógł się udać — odśwież” | 362e9d6 |
| ŚREDNI | Magazyn | PZ po cichu pomijał pozycje z ilością 0; ten sam numer faktury drugi raz bez pytania | 0a60e5f |
| WYSOKI | CRM (regresja r2) | blokada „Umowa” przy cenach 0 zł nigdy nie działała (karta nie pobierała pozycji) | af3dbcd |
| ŚREDNI | Zlecenia | filtr dnia / źródła działał po cichu tam, gdzie go nie widać (Aluminium, Drzwi wewn.); brak „ODBIÓR OSOBISTY”; pusty wynik bez informacji o filtrach | bf7e8ec |
| ŚREDNI | Bastion (regresja r1) | wydane zlecenia partii nie doładowywały się do końca sesji | 918d7c0 |
| ŚREDNI | Reklamacje (r2) | „Ukryj wydane” w Reklamacjach ładowało całą historię zleceń kategorii — własny przełącznik | 73be5cd |
| ŚREDNI | Okno programu | X okna zamykał program z niezapisanym formularzem bez pytania | ca8ebc0 |
| KRYTYCZNY | Statystyki | czas realizacji i wykres produkcji z dat wydania wpisanych z dnia synchronizacji Excela (ST 1046 z 1047) — pomijane, z licznikiem | 7e3efc9 |
| ŚREDNI | Pulpit / statystyki / prognozy | błąd wczytywania wyglądał jak „0” / „brak danych”; Prognozy zostawiały wykres poprzedniego komponentu; „Baseline” → „Średnie zużycie” | 5a11279 |
| ŚREDNI | Statystyki | kafelki i Top 10 liczą całą historię mimo wyboru okresu — opis w nagłówkach | c0bf343 |
| ŚREDNI | Alu | strona innego zlecenia doklejona do PDF wchodziła bez słowa; toast nie liczył uwag pozycji | e82abb1 |
| NISKI | Zaopatrzenie (r2) | po anulowaniu częściowo przyjętego ZD toast „anulowane” | fbc3bca |
| ŚREDNI | Weryfikacja | podpowiedź przy dublach bot+Excel kazała zostawić kopię z Excela (wbrew zasadzie „zostaje bot”) | ebcc365 |
| ŚREDNI | Statystyki | trend porównywał z okresem sprzed pierwszego zlecenia (ST/Bastion/Techniczne od 06.2026) — „za krótka historia” | ddb83eb |
| WYSOKI | Pulpit | przeterminowane liczone tylko w otwartej zakładce, na Pulpicie brak — kafel „Po terminie” dla całej firmy | ce0336b |
| KRYTYCZNY | Zlecenia | anulowane zlecenie dało się edytować i zapisać — przeliczenie zakładało mu rezerwacje; teraz podgląd z banerem, zapis zablokowany (świeży odczyt przed zapisem) | afd5500 |
| WYSOKI | Bastion / Titan | edycja nogi Titana w formularzu Bastion kasowała panel albo wpisywała kolor panelu jako typ ościeżnicy; zmiany nie szły do STA/ST | 01d9755 |
| WYSOKI | Zlecenia | numer pobierany przy otwarciu okna zajmował bot/Excel → surowy błąd 23505; pusty numer przechodził — teraz nowy numer i ponowienie | 1f5c17a |
| ŚREDNI | Zlecenia | ilość 1.5 / ujemna / 0 / 99999 bez sensownej kontroli — całkowita 1–1000, powyżej 50 pytanie | baf86d5 |
| WYSOKI | Zlecenia | edycja wysyłała wszystkie pola i nadpisywała zmiany innej osoby — wysyła tylko zmienione | 5753752 |
| ŚREDNI | Szyby | 504 przy zapisie daty = porażka (ryzyko podwójnego zamówienia); PDF z całego zaznaczenia — teraz „nie wiadomo, odśwież”, PDF tylko z oznaczonych | ba693a6 |
| NISKI | Zlecenia | brak potwierdzenia z numerem po dodaniu ST/Technicznego/Bastionu | e0af3e1 |
| NISKI | Zlecenia | kolumna WPISAŁ pusta (ręczne) / UUID (drzwi wewn.) — inicjały użytkownika | fedbf0a |
| ŚREDNI | Okno programu | zamknięcie programu pyta też przy otwartym oknie zlecenia (uzupełnienie ca8ebc0) | 9bcbc4b |

### Poprawione — funkcje Edge (repo, niewgrane)
| Waga | Funkcja | Problem | Commit |
|---|---|---|---|
| WYSOKI | crm-dokumenty (regresja r2) | druga umowa z tej samej oferty nadpisywała PDF istniejącej (także podpisanej), numer anulowanej wracał | bc6358d |
| ŚREDNI | excel-sync (r2 niepełna) | „ANULOWANE” w kolumnie „MAGAZYN, KONTROLA ODBIORCZA” dawało wydanie i rozchód | d00c238 |
| ŚREDNI | crm-call-ingest (regresja r2) | dopięcie po numerze z podpisu: nasze domeny, trwałe dopisanie adresu, nadpisanie zamkniętego klienta | 88df601 |
| NISKI | crm-call-ingest (r2) | numery z „/” w podpisie ginęły (test: `crmNormalizujTelefon.test.ts`) | 19072ae |

### Poprawione — baza (pliki migracji, niewgrane; każda sprawdzona w transakcji z rollbackiem)
| Waga | Problem | Plik | Commit |
|---|---|---|---|
| KRYTYCZNY | „Przywróć” po „Anuluj” podwajało rezerwacje (zlecenie 15402: 62,75 → 125,5) — po poprawce 62,75 → 0 → 62,75, suma rezerwacji magazynu bez zmian (sprawdzone dwa razy) | `20261127232000_rezerwacje_przywroc_bez_podwajania.sql` | 5b75f91 |
| — | porządki: 16 232 stare wiersze bez powodu → `superseded` (828 zleceń) — **do decyzji** | `20261127232100_rezerwacje_stare_bez_powodu_superseded.sql` | dc67845 |
| KRYTYCZNY | edycja anulowanego zlecenia zakładała rezerwacje (`reserve_stock_for_order` pomija anulowane) | `20261127232200_rezerwacja_pomija_anulowane.sql` | 719e3b7 |
| ŚREDNI | anulowanie przerwane w połowie zostawiało rezerwacje — trigger zwalnia je razem ze znacznikiem | `20261127232300_anulowanie_zlecenia_zwalnia_rezerwacje.sql` | 467a59e |
| WYSOKI | literówka w numerze z Excela psuła numerację kategorii (bigint, pomijanie numerów > mediana + 1000) | `20261127232400_numeracja_zlecen_odporna_na_literowki.sql` | 1385aac |
| ŚREDNI | NaN / Infinity w ilościach (PZ, MM, WZR, zniszczenia, spis, przyjęcie ZD) + `check` na stanach i ruchach; PZ/MM bez poprawnej pozycji = błąd | `20261127232500_magazyn_ilosci_bez_nan.sql` | e6523c8 |
| NISKI | `stat_zew_braki`: czas realizacji tylko z prawdziwych dat (bez szacunkowych, `release_date >= order_date`) | `20261127232600_stat_zew_braki_czas_realizacji.sql` | 68e95f0 |
| NISKI | reguły terminów zdublowane (id 5–8) + unikalność | `20261127232700_reguly_terminow_bez_duplikatow.sql` | ba5b8bd |
| WYSOKI | prognozy: średnia tylko z miesięcy > 0 i z niepełnym bieżącym, „wystarczające dane” przy 1 miesiącu (124 komponenty zmienią status; do końca grudnia wszystkie „za mało danych”, bo historia od 4.09) | `20261127232800_prognozy_pelne_miesiace.sql` | 49b9e33 |
| WYSOKI | (r2) scalanie etapów reklamacji aktualizowało w kółko co 15 min | poprawiony `20261127223000_…` | fa0a952 |
| NISKI | (r2) łączenie klientów kasowało pola firmy celu | poprawiony `20261127224000_…` | bc9b266 |
| NISKI | (r2) klient z zadaniem bez daty nigdy nie zamykany | poprawiony `20261127225000_…` | 3589c94 |
| NISKI | (r2) `return_stock_for_stage` omijał blokadę na wydanym | poprawiony `20261127230000_…` | d3855c8 |
| NISKI | (r2) ZD zamknięte po częściowym przyjęciu bez `received_at` | poprawiony `20261127231000_…` | 2d3e59d |

### Znalezione, nie poprawione (do decyzji / większe tematy / niskie)
- Pulpit: „aktywne zlecenia” = „Do wysłania” = 1818, w tym 797 Technicznych, które nigdy nie są wydawane, i 177 nóg Disting Plus z wydaną nogą STA — **decyzja** (czy wydanie STA zamyka Disting; jak liczyć „Do wysłania”).
- Auto-archiwizacja po 12 mies. (`created_at`) za pół roku utnie statystyki (import czerwcowy 5243 zleceń) — **decyzja** (ile historii w statystykach / archiwizacja po `order_date`).
- Pole „Kategoria” w formularzu nowego zlecenia pozwala zapisać zlecenie w innej zakładce z cudzym numerem — **decyzja** (czy ktoś tego używa).
- Dzień produkcji tylko z kartoteki firmy, nie da się go wybrać ręcznie — **decyzja**.
- „Duplikuj” z połówki zestawu (Disting Plus / Titan) tworzy niepełny zestaw — do zrobienia (pytanie przy duplikowaniu).
- Anulowanie Titana z zakładki Bastion anuluje tylko nogę Bastion — **decyzja**.
- Automatyczne wylogowanie po 60 min i bramka wersji podmieniają ekran z otwartym formularzem — do zrobienia (pasek z odliczaniem).
- Zgłoszenie zniszczeń z kilku pozycji: przy częściowym błędzie okno się zamyka (NISKI); szukanie w Dzienniku zmian wolne (indeks trigramowy, NISKI); `%`/`_` jako symbole wieloznaczne w kilku polach szukania (NISKI); „Generuj” + „Generuj wszystkie” ZD może zdublować (NISKI); `picked_at` z zegara komputera (NISKI); wykresy bez opisu jednostek, „per dzień tygodnia” sumuje sztuki (NISKI).
- `reserve_stock_for_order` nie sprawdza uprawnień wywołującego (EXECUTE dla authenticated) — do sprawdzenia w kolejnej rundzie.

Stan po rundzie: `tsc` OK, **684 testy** OK (było 648; nowe testy: mapowanie Bastion/Titan, ponawianie numeru, ilość, niepewny zapis, telefon z podpisu, strona innego zlecenia w LP), lint 66 problemów (bez zmian — wszystkie stare).

**Podsumowanie rundy 3:** znalezisk ok. 60 (krytyczne 4, wysokie ok. 15, średnie ok. 25, niskie ok. 15); poprawione 46 (w tym 9 uwag do poprawek z rund 1–2). Nowe KRYTYCZNE/WYSOKIE/ŚREDNIE były — warunek stopu (2 rundy bez nich) jeszcze niespełniony.

## Runda 4 (28.11 w nocy) — 4 testerów (recenzent poprawek aplikacji z r3, recenzent migracji i Edge z r3, magazyn / wysyłka / telefon, CRM Po Drzwi) + tor naprawczy bazy

### Znalezione
Ok. 40 znalezisk: krytyczne 3 (regresja r3: edycja nie zapisywała pól przeliczanych automatycznie; Excel zdejmował z magazynu części etapów „nie dotyczy” — 7 ram w 5 zleceniach ST; klient ze sklepu zamykany przez automat jako przegrany), wysokie ok. 12, średnie ok. 15, niskie ok. 10. Recenzent migracji: wszystkie pliki 223000–232800 przechodzą na obecnej bazie, łatki trafiają.

### Poprawione — aplikacja i Edge (repo)
| Waga | Obszar | Problem | Commit |
|---|---|---|---|
| KRYTYCZNY | Zlecenia (regresja r3) | edycja nie zapisywała szerokości naświetla, wysokości dostawki, etykiet Bastion, zakresu ościeżnicy (łatka liczona ze zrzutu z poprawkami automatycznymi) | f550afa |
| ŚREDNI | Statystyki (r3 niepełna) | karta firmy liczyła czas realizacji z dat z dnia synchronizacji Excela (59 dni zamiast 8) | 251760a |
| WYSOKI | Zlecenia (regresja r3) | po zerwanym połączeniu ponowne „Dodaj” dostawało nowy numer = dubel z podwójną rezerwacją — teraz pytanie | d93df83 |
| ŚREDNI | Aktualizacja | instalator zamyka program siłą — pytanie o niezapisane PRZED instalacją | 2c9c555 |
| NISKI | Magazyn | zgłoszenie zniszczenia nie wstrzymywało zamknięcia programu | e8dce8a |
| ŚREDNI | Pulpit | „Po terminie” liczył pary Disting Plus / Titan podwójnie | b927bf2 |
| WYSOKI | CRM | „Wysłałem” kasował umówiony pomiar / montaż, „Zapytaj o decyzję” u klienta, który już zamówił | 20302d8 |
| WYSOKI | CRM | formularz umowy podpowiadał najstarszą ofertę z inną kwotą | 5c39e4e |
| ŚREDNI | CRM | status umowy przestawiany jednym kliknięciem (Podpisana → Projekt = numer wraca) | 4a1395b, 218a454 |
| NISKI | CRM | szukanie klientów bez firmy i NIP | 4f1f472 |
| WYSOKI | Wydanie / wysyłka | anulowane zlecenie dawało się wydać (telefon, komputer, drzwi wewn.) i wysłać kurierem | 63a4a26 |
| ŚREDNI | Hala | P0409 (cofnięcie etapu na wydanym) — komunikat po ludzku | 9ac631a |
| ŚREDNI | Ustawienia | zdublowana reguła terminów — surowy błąd | bd2d899 |
| ŚREDNI | crm-call-ingest (r3 niepełna) | zamknięty klient dopasowany po numerze z podpisu — zmiana ceny, kategorii, etykiet, nowa oferta | 97cb7a8 |
| NISKI | excel-sync | „ANUL” w kolumnie „zrobione” = wydanie | 271fe32 |
| ŚREDNI | Telefon | wydanie drzwi wewn. bez „spakowane x/y” i ostrzeżeń | 8fc9f3f |

### Poprawione — baza (pliki migracji, niewgrane; każda sprawdzona w transakcji z rollbackiem)
| Waga | Problem | Plik | Commit |
|---|---|---|---|
| KRYTYCZNY | etap „nie dotyczy” (#ND) schodził przy wydaniu końcowym; #ND wpisany po wydaniu zwraca towar (ZWR) | `20261127233000_nd_etap_nie_wydawany_przy_wydaniu.sql` | fbfa0f3 |
| — | korekta 7 ram (zlecenia 17431, 17437, 17588, 17589, 17625; BUKOWA) — **do decyzji** | `20261127233100_korekta_nd_ramy_zwrot.sql` | cb98c24 |
| WYSOKI | cofnięcie zniszczenia przypiętego do zlecenia drzwi wewn. = drugie wydanie | `20261127233200_drzwi_wew_wydanie_bez_ruchow_zniszczen.sql` | 966ef90 |
| WYSOKI | anulowane zlecenie: wydanie drzwi wewn. (P0410), trigger na dacie wydania (tylko użytkownik), `zlec_przesylke_bl` odmawia przed BaseLinkerem | `20261127233300_anulowane_bez_wydania_i_wysylki.sql` | 2c9d409 |
| WYSOKI | przerwane „Przywróć” + edycja + drugi cykl = podwójne rezerwacje — świeże rezerwacje zastępują stare anulowania | poprawiony `20261127232200_…` | 9806eae |
| ŚREDNI | wyłączona reguła terminów blokowała dodanie nowej — unikalność tylko aktywnych | poprawiony `20261127232700_…` | 6323da7 |
| ŚREDNI | `crm.dodaj_etykiety` / `crm.nastepny_numer_oferty` dla każdego zalogowanego (także bez CRM) | `20261127233400_crm_etykiety_numer_oferty_uprawnienia.sql` | 5cb3645 |
| KRYTYCZNY | porządki CRM zamknęłyby jako przegranego klienta z opłaconym zamówieniem sklepowym (10 klientów); przy automatycznym zamknięciu oferty wysłane → odrzucone | poprawiony `20261127225000_…` | 17a5cdb |
| ŚREDNI | podpisana / anulowana umowa: trigger blokuje zmianę statusu i numeru | `20261127233500_crm_umowa_podpisana_bez_zmian.sql` | eb60328 |

### Znalezione, nie poprawione (do decyzji / większe)
- Spis z kartki + PZ w międzyczasie = dostawa znika ze stanu — **decyzja** (blokada ruchów przy otwartym spisie czy różnica od godziny liczenia).
- Zmiana receptury pomija zlecenia, z których coś zeszło (STA 47/92, Disting 90/282); przeliczenie z przeglądarki po 15 s; zapis receptury w dwóch krokach — **decyzja** + przeniesienie do bazy.
- MM towaru zarezerwowanego zostawia rezerwacje na starym magazynie — **decyzja**.
- „Oznacz jako wydane” w Wysyłkach nie robi rozchodu od 7.11 (dziś nieużywane) — **decyzja** (granica daty).
- Klient ze sklepu zostaje „Nowy” (crm-bl-sync nie zmienia statusu) — **decyzja** (czy samo zamówienie wystarcza).
- Klient wracający po przegranej: oferty zostają odrzucone, „Zamówił” i umowa nie mają oferty — **decyzja**.
- Duplikaty CRM: samo imię daje 85 % pewności mimo różnych telefonów / maili — do zrobienia.
- Usunięcie klienta / oferty nie kasuje PDF-ów (brak polityki DELETE w buckecie, RODO) — **decyzja**.
- Prognozy (232800) zmienią też Alerty: 19 krytycznych → „brak danych” — dopisane do decyzji 3.
- Drobne: odhaczenia ręcznych drzwi wewn. kasowane przy edycji, telefon nie widzi zmian pozycji z Optimy w trakcie pakowania, brak plakietki CRM w menu, dostawa + odbiór po łączeniu, numer ręcznych drzwi wewn. „1, 2…” zamiast RB/…

Stan po rundzie: `tsc` OK, **687 testów** OK, lint bez nowych problemów.

**Podsumowanie rundy 4:** znalezisk ok. 40; poprawione 26 (w tym 2 regresje i 4 poprawki niepełne z rundy 3). Nowe KRYTYCZNE/WYSOKIE były — warunek stopu niespełniony.

## Runda 5 (28.11 w nocy) — recenzent aplikacji r4, próba generalna wszystkich migracji, uprawnienia / admin / wejście zleceń

### Znalezione
Ok. 30 znalezisk: krytyczne 3 (bez logowania można anulować / przywracać rezerwacje — `cancel_/restore_stage_reservations__impl` dla anon; `reserve_stock_for_order` dla każdego zalogowanego; regresja r4: edycja Bastionu kasowała zakres ościeżnicy przy zabudowie — wysoki), wysokie ok. 8 (kierownik działu bez zakresu kategorii w bazie, dowolny stan magazynu z F12 bez audytu, admin mógł przejąć konto CRM Po Drzwi, dubel bot↔Excel z innym towarem znikał), średnie ok. 12, niskie ok. 7.
**Próba generalna:** wszystkie 20 plików migracji (223000–233500) przechodzą w kolejności nazw w jednej transakcji (kilka sekund), 37 znaczników poprawek obecnych w końcowych definicjach, dymne testy zgodne (anuluj/przywróć 15402, #ND 17626/17588, drzwi wewn. 29364, NaN, numeracja, prognozy, porządki CRM, reklamacje 402).

### Poprawione — aplikacja i Edge (repo)
| Waga | Obszar | Problem | Commit |
|---|---|---|---|
| WYSOKI | Bastion (regresja r4) | otwarcie edycji kasowało „Zakres ościeżnicy” przy zabudowie (12 otwartych zleceń) | b24ca64 |
| ŚREDNI | CRM | po „Wysłałem” komunikat obiecywał follow-up, którego nie było | bc580eb |
| ŚREDNI | Zlecenia (r4 niepełna) | dubel po zerwanym połączeniu: pary Disting Plus / Titan i firma z aliasem bez pytania — kontrola przed zapisem | 954fa45 |
| NISKI | Aktualizacja | flaga instalacji nie wracała, gdy program się nie zamknął | 033fa24 |
| NISKI | Ustawienia | włączenie zdublowanej reguły — surowy komunikat | 753ebf8 |
| NISKI | CRM | blokada statusu „podpisana” także dla karty / protokołu | f864e45 |
| ŚREDNI | Logistyka | „Dodaj do trasy” przy odmowie bazy pokazywało zielone „Dodano…” | a7ea009 |
| WYSOKI | manage-users | admin mógł zresetować hasło / zablokować / usunąć konto z dostępem do CRM Po Drzwi | bacc1ec |
| ŚREDNI | manage-users | usunięcie konta z historią po cichu zerowało autora (22 kolumny) — odmowa | 4ee1867 |
| ŚREDNI | Użytkownicy | lista bez statusu blokady, okno obiecywało odblokowanie — kolumna „Status”, „Odblokuj” | 48b2dc6 |
| WYSOKI | orders-excel-intake | wiersz z innym towarem / ilością / wykonawcą niż bot znikał jako dubel — teraz Weryfikacja | 381658d |

### Poprawione — baza (pliki migracji, niewgrane; każda sprawdzona w transakcji z rollbackiem)
| Waga | Problem | Plik | Commit |
|---|---|---|---|
| KRYTYCZNY | **PILNE** — anon wykonywał 26 funkcji public (m.in. anulowanie/przywracanie rezerwacji, dane ZD); odebrane, zostają tylko funkcje ekranu logowania | `20261127234000_pilne_anon_bez_funkcji.sql` (samodzielny, powtarzalny) | 58154fd |
| KRYTYCZNY | `reserve_stock_for_order` i `revalidate_bot_order` dla każdego zalogowanego — tylko kierownik / klucz serwisowy | `20261127234100_rezerwacja_i_weryfikacja_bota_tylko_kierownik.sql` | 22c5f3f |
| WYSOKI | kierownik działu bez zakresu kategorii (zmiana / anulowanie / kasowanie cudzych zleceń, reguły, kontrahenci) | `20261127234200_kierownik_dzialu_zakres_kategorii.sql` | 3ef9592 |
| WYSOKI | dowolny stan magazynu z F12 bez dokumentu i audytu — stany tylko przez funkcje, audyt stanów i receptur | `20261127234300_magazyn_stany_tylko_przez_funkcje_audyt.sql` | eedf23b |
| WYSOKI | zdjęcie „nie dotyczy” na wydanym zleceniu zostawiało rezerwację na zawsze — P0409 | `20261127234400_etap_nd_na_wydanym_bez_przywracania.sql` | c5d3896 |
| ŚREDNI | migracja NaN nie dawała się uruchomić ponownie | poprawiony `20261127232500_…` | 5fc33ac |
| ŚREDNI | ponowne uruchomienie 233200 kasowało blokadę wydania anulowanych | poprawione `233200` / `233300` | 883d861 |
| NISKI | prognozy: pierwszy niepełny miesiąc liczony jak pełny | poprawiony `20261127232800_…` | 470b34e |
| WYSOKI | rolę / kategorie / usunięcie konta z dostępem do CRM zmieniał admin bezpośrednio w bazie | `20261127234500_konta_crm_tylko_superadmin.sql` (gałąź DELETE nieprzetestowana — konektor zawiesza się na `delete from profiles`) | b2c6ce8 |
| — | skrypt kontroli po wdrożeniu (pusty wynik = wszystko wgrane) | `scripts/kontrola-po-wdrozeniu.sql` | 6499a5a |

Uwagi: audyt na `warehouse_stock` dopisuje wpis przy każdej zmianie rezerwacji (szybszy wzrost `audit_log`); usunięcie komponentu z niezerowym stanem zostanie odrzucone przez bazę (polityka „tylko zero”); plik 234000 zaleca się puścić ponownie po wgraniu całości (nowe funkcje dostają domyślnie EXECUTE dla PUBLIC).

### Znalezione, nie poprawione
- Do decyzji: D2 (rejestracja kont), D11 (Weryfikacja dla kierownika działu), D12 (ceny dla hali), D31 (magazynier a trasy), D32 („90” vs „90E”), D10 (MR Profil — RO przepada bez śladu).
- Dezaktywacja nie odcina od razu (token do ~60 min; potrzebny znacznik „nieaktywny” w profilu sprawdzany w bazie) — do zrobienia w bazie.
- Konto bez profilu czyta całą bazę (polityki „zalogowany” zamiast „ma profil”) — powiązane z D2.
- Zmiana roli innej osoby: menu u niej zmienia się dopiero po ponownym wczytaniu programu (NISKI).
- Pomoc (`HelpView.tsx`) nie wspomina o „Odblokuj” i zakazie usuwania kont z historią (NISKI).

Stan: `tsc` OK, **698 testów** OK.

**Podsumowanie rundy 5:** znalezisk ok. 30 + 6 z próby generalnej; poprawione 21 (aplikacja/Edge 11, baza 10). Nowe KRYTYCZNE były — od tej nocy warunek stopu wyłączony, testy pogłębiane.

## Zgłoszenie właściciela (28.11 w nocy): CRM nie umie wycenić Bastion P-110
- **Objaw**: oferta (lead 5e016d87…, oferta a5e17c9c…) — „System nie dobrał produktu: Bastion P-110 (ID 48895) nie jest na liście kandydatów”; handlowiec podał nazwę, link i ID — bez skutku.
- **Przyczyna**: prefiltr `kandydaci()` w Edge `crm-oferta` (v29) rozpoznawał wzory Bastion tylko z literą A/B (`[ab]-?\d{3}`). P-110 nie dostawał punktów za model, a 8 miejsc na liście zajmowały inne Bastiony (cennik: A 23, B 21, P 22, N 11, T 11, L 3, LUX 5, STD 2). Numer produktu wpisany w tekście (ID / link `?p=`) nie był brany pod uwagę.
- **Poprawka**: commit f1cb07b — wzory `A/B/N/P/T/L-NNN(NN)`, `LUX-`, `STD-`; produkt wskazany numerem (`ID 48895`, `#48895`, `?p=…`) zawsze na pierwszym miejscu listy. Test `src/__tests__/crmOfertaKandydaci.test.ts` (5 przypadków; na starym kodzie 4 padają). Źródło v29 pobrane z serwera do repo (b2f4cb9, bez zmian), bo funkcja była tylko na serwerze.
- **Wdrożenie**: NIE wdrożone (zasada nocy). Do wdrożenia: `supabase/functions/crm-oferta` (6 plików) — patrz DECISIONS D39. Po wdrożeniu: w ofercie kliknąć „Zapisz odpowiedzi i policz od nowa” (albo „Policz od nowa”).

## Runda 6 (28.11 w nocy, pogłębiona) — przekrojowe scenariusze, wydajność, obsługa błędów
Tryb nocny: branch `night-testing-2026-11-27`, warunek stopu wyłączony.

### Obsługa błędów (tester: 385 zapisów w `src/`, 126 w Edge; 278/385 obsłużonych porządnie)
| Waga | Problem | Poprawka | Commit |
|---|---|---|---|
| WYSOKI | kontrole przed zapisem przepuszczały przy nieudanym odczycie (dubel zlecenia, anulowane w wysyłce i wydaniu drzwi wewn., ta sama faktura PZ, partner przy przeliczeniu) — właśnie na słabym łączu | przerwanie z komunikatem / pytanie | 501aad8 |
| ŚREDNI | data zamówienia szyby u partnera Disting Plus i intarsja zestawu Titan — błąd tylko w konsoli | komunikat na ekranie, bez lokalnego „zamówione” | cac3610 |
| ŚREDNI | para reklamacji Disting Plus (etap, realizacja, pilność) rozjeżdżała się po cichu (komputer, Moje stanowisko, telefon) | komunikat „para nie zsynchronizowana” | db5679e |
| ŚREDNI | usunięcie komponentu przechodziło, gdy kontrola rezerwacji / receptur / stanu nie dała się odczytać | przerwanie | 4dac423 |
| WYSOKI | crm-mail-sent: błąd jednego maila przesuwał UID (mail przepadał), wychodzący „przetworzony” przed dopasowaniem do oferty | UID stoi na ostatnim udanym, „zatruty” mail pomijany po 2. błędzie ze zdarzeniem; wychodzący „nowy” do dopasowania | 6eb121a |
| WYSOKI | crm-call-ingest: brak limitów czasu (rozmowa mogła utknąć jako „nowa”), zapisy klienta bez sprawdzenia błędu | `AbortSignal.timeout` 60–120 s, ponawianie zawieszonych > 15 min, błąd zapisu → „blad” i ponowienie (bez dublowania oferty) | 1112c7c |
| WYSOKI | orders-intake / excel-intake: noga Titana lub para Disting Plus po cichu nie powstawała, a STA dostawało `titan_group` | Weryfikacja z ostrzeżeniem, ponawianie numeru, bez dublowania istniejących nóg (4 nowe testy) | a2c721d |
| ŚREDNI | excel-sync: błąd etapów / reklamacji tylko w odpowiedzi HTTP | zapis w `excel_sync_runs` | d7431db |

### Przekrojowe cykle życia (Titan, Disting Plus, bot+Excel+Optima, drzwi wewn., reklamacje, granice dat)
- KRYTYCZNY — Excel zdejmuje drugi raz towar wydany przed spisem 6.11 (próg = dzień synchronizacji; 5 zleceń STA, 280 szt.) → **D42** (decyzja, pilne).
- WYSOKI — wydane zlecenie po edycji / „Anuluj → Przywróć” dostaje rezerwacje, których nikt nie zdejmie (724 zlecenia narażone) → **poprawione** 4f64bf7 (plik 235000).
- WYSOKI — zdjęcie „nie dotyczy” na anulowanym zleceniu zakłada rezerwacje (poprawka 234400 dotyczy tylko wydanych) → **poprawione** fdedf00 (plik 235100).
- ŚREDNI — synchronizacja reklamacji cofa „Cofnij realizację” i cofnięcie etapu → rozszerzone D22.
- ŚREDNI — „Anuluj” działa na wydanym zleceniu i przechodzi na wydanego partnera → **D43**.
- ŚREDNI — `optima-ro-import`: RO anulowane i przywrócone w Optimie kasowało ręczne wydanie → **poprawione** cab1bcf (osobny znacznik `cancelled_by_import`, test na prawdziwej funkcji z pliku Edge; źródło v13 pobrane do repo 412e87a; niewgrane). Dziś 279 zleceń anulowanych importem ma stary znacznik, żadne z datą wydania — bez skutków.
- ŚREDNI — archiwizacja zrywa powiązania (pary, reklamacje, partie) → rozszerzone D26.
- NISKI — 5 nóg Disting z rezerwacjami przy anulowanym STA → **D44**.
- Dobrze: `reserved_quantity` = suma aktywnych rezerwacji na wszystkich 872 półkach; brak rezerwacji na wydanych / anulowanych; kaskada anulowania Titana spójna; strefa czasowa bez problemu w praktyce.

### Wydajność (+500 / +2000 otwartych zleceń, +10 tys. ruchów — w transakcjach cofanych)
| Zapytanie | Dziś | Przy +N | Uwagi |
|---|---|---|---|
| Zakładka STA (niewydane) | 11 ms, 0,5 MB | +2000: 213 ms, 7,9 MB | indeks OK; ciężar = `select *` |
| Pulpit | 21 ms | +2000: 77 ms | OK |
| Weryfikacja | 5 ms | 5 ms | OK |
| Wysyłka (otwarte) | 172 ms, 6 MB | +2000: 403 ms, 13,4 MB | lista kolumn → D48 |
| **Statystyki** | **4,3 s, 67 MB** (24 porcje, seq scan + sort w każdej) | 74,5 MB | **WYSOKI** → poprawione 1f41820 (15 kolumn ≈ 7–16 MB, porcje po `id`); agregaty w bazie → D47 |
| Ctrl+K | ~100 ms (seq scan) | 113 ms | indeks trigramowy → D49 |
| Dziennik zmian (zimny start) | 3,0 s | rośnie liniowo | indeks częściowy → D49 |
| `get_stock_alerts` | 135–205 ms | 166–195 ms | OK |
| **MM / korekta / WZR zbijające stan poniżej rezerwacji** | ~3,5 s (219 zleceń) | **+500: 8,4 s → przekroczenie limitu, dokument się nie zapisuje** | **WYSOKI** → D45 |
| **Przeliczenie po zapisie receptury** | STA ~6 s, ~2,4 tys. zdarzeń realtime | **+2000: ~126 s, ~53 tys. zdarzeń** | **WYSOKI** → D46 |
| PZ (1 pozycja) | 442 ms | +2000 z brakiem: 2,3 s i 8,8 MB audytu | ŚREDNI → D45 |
| Wstawienie zlecenia STA/Disting | 10–12 ms (trigger duplikatów 95%) | rośnie z historią | indeks (category, created_at) → D49 |
| `sync_releases_from_excel` (próbnie) | 11 tys. wierszy 276 ms | — | OK |

Poprawione od razu (aplikacja): liczniki „po terminie” liczone raz na zmianę listy zamiast przy każdym renderze (2b9ffd8); STA Titana w tabeli przez `Map` (O(n²) → O(n), 40e7add); powiązane zlecenia STA / rodzeństwo Titana porcjami po 150 (942d990). Skutek uboczny testów wydajności: luki w sekwencjach `id` (np. `orders_id_seq` 29 366 → 40 504) — tylko numery techniczne, `order_number` bez zmian.

### Baza — poprawki rundy 6 (pliki, niewgrane)
| Waga | Problem | Plik | Commit |
|---|---|---|---|
| WYSOKI | wydane zlecenie dostawało rezerwacje po edycji / „Anuluj → Przywróć” (724 narażone) | `20261127235000_wydane_zlecenie_bez_nowych_rezerwacji.sql` | 4f64bf7 |
| WYSOKI | zdjęcie „nie dotyczy” na anulowanym zleceniu przywracało rezerwacje (+ lustro: #ND na anulowanym nie wraca przy „Przywróć”) | `20261127235100_nd_na_anulowanym_bez_przywracania.sql` (po 233000) | fdedf00 |

Nie poprawione (opis w DECISIONS): edycja ręcznego zlecenia drzwi wewn. w 4 krokach bez transakcji (D40), wydanie z magazynu przy błędzie RPC zostawia rezerwacje bez śladu (D41), CRM: przy usuwaniu najpierw pliki, potem rekord (NISKI), ustawienia: zapisy dwukrokowe (NISKI), ok. 60 drobnych miejsc bez odczytu `error` (lista: `scratchpad/a6err/scan.txt` — do poprawy hurtem). Funkcje SQL: 13 `when others then null` obejmuje tylko wpis do audytu (nie dane) — NISKI.

## Runda 7 (28.11 w nocy) — recenzja poprawek rundy 6 i nocnych
Brak KRYTYCZNYCH i WYSOKICH. Próba generalna: 28 plików 223000–235100 w kolejności nazw w jednej transakcji — bez błędu, skrypt kontroli pusty (z 4 nowymi znacznikami). Porównanie starej i nowej `kandydaci()` na 553 prawdziwych analizach CRM: 6 list lepszych, 0 gorszych.

| Waga | Problem | Poprawka | Commit |
|---|---|---|---|
| ŚREDNI | crm-oferta: „→ id=48895” (tak napisał handlowiec), „ID produktu: …” i link `/produkt/<slug>/` nierozpoznane; wskazanie nie działało dla drzwi wewn.; dwie cyfry dla wszystkich liter Bastionu („b12”, „a10”) | rozpoznawane wszystkie formy + link po slugu, wskazany produkt zawsze pierwszy (także drzwi wewn.), 2 cyfry tylko L-/STD- (3 nowe testy) | 1d85ca7 |
| ŚREDNI | crm-mail-sent: ponowienie maila do A i B zamykało cały mail po zdarzeniu A — B nigdy nie dopasowany | duplikat per adres (`dane.adres`) | 4d8775b |
| ŚREDNI | crm-mail-sent: mail pominięty po 2 błędach wisiał jako „Czeka na analizę” (ekran odświeżał się co 10 s bez końca) | status „blad” | a79c1d1 |
| NISKI | skrypt kontroli nie sprawdzał 235000 / 235100 | dopisane 4 znaczniki | a368b33 |
| NISKI | liczniki „po terminie” nie przeliczały się po zmianie dnia (po memoizacji) | data w zależnościach | e87f51e |
| — | lint: 3 brakujące zależności hooków po zmianie zrzutu formularza + 4 zbędne wyłączenia reguły | lint = 66 ze startu + 17 starych w `optima-ro-import` (plik z serwera) | fc4202e |

Nie poprawione (NISKI): błąd etapów / reklamacji z excel-sync zapisany w historii, ale niewidoczny w aplikacji (`summary.blad`); orders-intake: błąd odczytu istniejących nóg Titana nadal tylko w logu + brak przycisku „dorób nogę” (decyzja); crm-call-ingest: ponowienie dubluje zdarzenie „oferta zlecona” z mylącym opisem.

## Runda 8 (28.11 w nocy) — ZKP i pełny cykl aluminium; Ustawienia, etykiety, powiadomienia, archiwum
Stan: na produkcji 4 zlecenia alu, 0 kart / protokołów / deklaracji ZKP, nikt nie ma roli Pełnomocnika — obieg ZKP nieużywany na żywo; testy przez symulację pełnego cyklu w transakcjach cofanych.

### ZKP i aluminium
| Waga | Problem | Stan |
|---|---|---|
| KRYTYCZNY | zlecenia ZKP (AS 75EI) nie da się nigdy wydać — pozycja teczki „Zlecenie produkcyjne” zawsze „brak” (`alu_dossier_status` bez gałęzi) | **poprawione** 1a544bc (`20261128000000`; pełny cykl w transakcji: wydanie przechodzi) |
| KRYTYCZNY | protokół zamykany jako ZWOLNIONY na starej ocenie pomiarów po zmianie karty | **poprawione** e4dbf3c (`20261128000100`; ocena liczona od nowa, „karta zmieniona po zapisaniu protokołu”) |
| WYSOKI | każdy kierownik może wyłączyć ZKP na zleceniu 75EI | **D52** |
| WYSOKI | „Nadpisz” nowej LP anuluje zwolnioną konstrukcję z deklaracją i gubi etapy | **D55** |
| WYSOKI | podpis etapu ZKP inicjałami innej osoby | **D53** |
| WYSOKI | etapy (z pakowaniem) przed „Uruchom do produkcji” i przed zwolnieniem | **D54** |
| ŚREDNI | konstrukcja NIEZGODNA blokuje zlecenie na zawsze | **D56** |
| ŚREDNI | zlecenie mieszane 75EI + AS75 w całości ZKP | **D57** |
| ŚREDNI | przyjęcie partii niezgodnej jako PRZYJĘTO, dostawca po terminie oceny „kwalifikowany” | **D58** |
| ŚREDNI | eksport teczki (ZIP) bez kart, protokołów i deklaracji (generatory są w programie) | do zrobienia → **D61** |
| ŚREDNI | etykiety alu: wieczne „wczytuję” przy błędzie drukarek, błąd szablonów jak „brak szablonów”, druk ZKP bez numeru konstrukcji | **poprawione** 9974476 |
| NISKI | okucia i wypełnienia w karcie przed potwierdzeniem zakresu | **poprawione** 5273ae0 (`20261128000200`) + zakładki w oknie karty |

### Ustawienia, druk, powiadomienia, archiwum, komentarze, zdjęcia
| Waga | Problem | Stan |
|---|---|---|
| KRYTYCZNY | szablon etykiety mógł uruchomić skrypt w oknie programu (podgląd w iframe bez sandbox) i wykraść sesję każdego, kto otworzy podgląd; szablony edytuje też kierownik działu | **poprawione** 35f82b1 (sandbox na 4 podglądach; żaden szablon nie używa skryptów); kto edytuje szablony → **D59** |
| WYSOKI | powiadomienia: superadmin nic nie dostaje od 13.11, konto zablokowane dostaje dalej | **poprawione** 267ef27 (`20261128010000`) |
| WYSOKI | `notify_comment_mentions` z F12 zasypuje firmę (5 wywołań = 65 powiadomień) | **poprawione** 492071f (`010100`: tylko `@Imię` z treści, raz na komentarz) |
| WYSOKI | bezpiecznik słownika nie widzi koloru ościeżnicy ani receptur (usunięto CZARNY mimo 82 zleceń) | **poprawione** 3bbde09 (`010200`) + komunikat w aplikacji c9a2dc3; 136 z 708 wartości staje się nieusuwalnych (są używane) |
| ŚREDNI | zmiana nazwy w słowniku zostawia martwe wykluczenia (90 w STA) | **D60** |
| ŚREDNI | przywracanie z archiwum gubi zdjęcia i wysyła fałszywe „do weryfikacji” | **poprawione** 63fef17 (`010300`) |
| ŚREDNI | anon może wylistować pliki w `order-photos` / `feedback-attachments`; `order_photos_insert` bez kontroli autora | **poprawione** 85d6f6d (`010400`) |
| ŚREDNI | `{{ firma }}` / `{{Firma}}` drukowało „-”; dane z `{{…}}` podstawiane drugi raz | **poprawione** 80ce62b (2 testy) |
| ŚREDNI | kierownik działu dostaje 87% powiadomień spoza swoich kategorii | **D11** (rozszerzone) |
| NISKI | „Oznacz wszystkie” tylko 30 wczytanych (5038 nieprzeczytanych w bazie); brak ikony `stock_critical` | **poprawione** ee8b25f |
| NISKI | 1507 pustych wpisów w historii zlecenia („Brak listy zmienionych pól”) | **poprawione** (nazwa operacji zbiorczej) |
| NISKI | brak audytu na `label_templates`, `config_exclusions`, `dimension_map`; brak `check` wymiarów etykiety | **poprawione** fb4fa91 (`010500`) |
| NISKI | błąd usuwania wymiaru i zdejmowania „domyślnego” szablonu ignorowany | **poprawione** 3f6592a |

## Runda 9 (28.11 w nocy) — recenzja rundy 8, nocnych refaktorów i próba generalna wdrożenia
Próba generalna: wszystkie 37 plików `20261127223000` … `20261128010500` w kolejności nazw, w jednej transakcji (cofniętej), potem `scripts/kontrola-po-wdrozeniu.sql` → **żaden plik nie padł, kontrola pusta**. Polityki `storage.objects` da się założyć kontem `postgres`.

| Waga | Problem | Stan |
|---|---|---|
| KRYTYCZNY | sandbox chronił tylko podgląd — ukryte okna druku (`label:printHtml`, `print:exportPdf`) ładowały szablon z JS i w sesji okna głównego (wspólny `localStorage` dla `file://`, tam sesja Supabase) | **poprawione** 3075055 (`javascript: false`, `sandbox`, partycja `druk`; QR i strony deklaracji to już obrazki z renderera). Do sprawdzenia rano w zbudowanym programie: wydruk etykiety STA/alu i „Zapisz PDF” |
| NISKI | kontrola po wdrożeniu nie widziała odebrania `notify_user_active` / `restore_from_archive__impl` kontu authenticated | **poprawione** 2b41af3; porządki danych 232100/232700/233100 nadal bez sprawdzenia (to jednorazowe UPDATE-y) |

Sprawdzone bez błędu: podgląd z `sandbox=""` (QR, style, nic nie czyta iframe'ów); `labelRender` jedno przejście = stary kod (216 porównań na 6 szablonach i 12 prawdziwych zleceniach, 0 różnic); `config_option_usage` śr. 13,5 ms / maks. 95 ms; polityki storage nie psują wgrywania zdjęć i załączników; przywracanie z archiwum (0 powiadomień, zdjęcia wracają); audyt 010500 zapisuje 3 wpisy z autorem; ZKP 000000–000200 (bez dublowania pozycji teczki, ponowny protokół zdejmuje blokadę); refaktory znak w znak, nic osieroconego.

## Runda 10 (28.11 w nocy) — równoczesna praca, dane brzegowe i eksporty, telefon / sesja / sieć
3 testerów (tylko odczyt, symulacje w cofanych transakcjach) + tor naprawczy bazy (`r10-baza`).

### Równoczesna praca kilku osób
| Waga | Problem | Stan |
|---|---|---|
| WYSOKI | etap wstrzymany (#WS) w trakcie oznaczania: WZ schodzi, etap zostaje wstrzymany | **poprawione** b05c0af (`021000`: odmowa P0404 dla nie-kierownika; zostaje ułamek sekundy między wydaniem a zapisem — pełne domknięcie = jedno RPC) |
| WYSOKI | okno ZD pokazuje status z chwili otwarcia, a baza pozwala zmieniać pozycje każdej ZD | okno: **poprawione** d6bc055; baza: **poprawione** dc0a074 (`021100`); status całej ZD → **D69** |
| ŚREDNI | etap cofnięty w programie wraca z Excela z ponownym WZ | **D64** |
| ŚREDNI | szkice ZD nie liczą się „w drodze” — dwie osoby zamówią to samo | **D65** |
| NISKI | anulowanie drzwi wewn. to dwa kroki, zwrot bez blokady zlecenia | do zrobienia (jedna funkcja SQL; okno ułamka sekundy) |
| NISKI | „Zamów szybę” — dubel do szklarza przy dwóch kliknięciach | **poprawione** 777ca9a (świeży odczyt daty przed wysyłką) |
| NISKI | deklaracja ZKP: dwie równoczesne na te same konstrukcje | **poprawione** 2819e08 (`021200`) |
| NISKI | partia Bastion otwarta na zawsze przy równoczesnym skręceniu dwóch ostatnich | **poprawione** 4650dd8 (`021300`) |
| NISKI | numery partii / pozycji dodatkowych Bastion max+1 → surowy błąd „duplicate key” | bez zmian: toast już tłumaczy duplikat („odśwież listę”) |
| NISKI | PZ / MM bez numeru dokumentu: numer z sekundą może się zdublować | do zrobienia |

### Dane brzegowe, daty, eksporty
| Waga | Problem | Stan |
|---|---|---|
| WYSOKI | niemożliwa data w Excelu („31.11”) wywraca całą synchronizację reklamacji kategorii (i wydań) | **poprawione** 514c973 (`021500` + Edge `excel-sync` w repo, niewdrożony; test) |
| WYSOKI | `lpad` obcina numery: setna umowa w roku = „10/MM/RRRR” (bez unikalności), oferty / RK / ZD od 1000 | **poprawione** bc9f110 (`021600`; licznik umów 2026 = 71); unikalność → **D70** |
| ŚREDNI | ręczne wiązanie zlecenia Po Drzwi „nie znajduje” starszych (limit 60 wszystkich firm) | **poprawione** c02fc7b |
| ŚREDNI | „Powierzchnia m²” („150 m2”, „ok. 150”) po cichu null — kontrola VAT 8% się nie odbywa | **poprawione** 07b04fb (+ test) |
| NISKI | „dziś” i rok w numeracji w bazie liczone w UTC (0:00–2:00 = wczoraj / zeszły rok) | do zrobienia (`dzis_pl()`; dziś 0 przypadków) |
| NISKI | „ostatni miesiąc / kwartał” skraca się na końcu miesiąca (31.03 → od 3.03) | **poprawione** 308a374 (`minusMonths` + test) |
| NISKI | progi dni przez zmianę czasu (wysyłka „stare po 30 dniach”, wiek pozycji Bastion) | **poprawione** 7313234 (+ testy) |
| NISKI | eksporty CSV magazynu bez ochrony przed formułami Excela | **poprawione** 695229f (`csvCell` + test; 2 kopie → 1) |

### Telefon, utrata sesji i sieci, aktualizacje
| Waga | Problem | Stan |
|---|---|---|
| WYSOKI | „Wydane” po zgubionej odpowiedzi: data zapisana, WZ nie poszła, ponowienie „już wydane” | **poprawione** 8a20b34 |
| ŚREDNI | powrót do aplikacji czyta profil bez sprawdzania błędu → „??”, pusta rola, znika Wysyłka | **poprawione** 15473ad |
| ŚREDNI | telefon pokazuje wszystkie kategorie; kierownik działu STA odhacza drzwi wewn. | **D62** |
| ŚREDNI | aluminium: ponowienie po zgubionej odpowiedzi odlicza drugą sztukę | **poprawione** 6cedff0 (migracja `20261128020000`) + b6b83a1 (aplikacja; bez migracji działa jak dotąd) |
| ŚREDNI | kanały „na żywo” bez przeładowania po przerwie (8 miejsc) | **R10** (refaktor do rozważenia) |
| ŚREDNI | brak limitu czasu zapisów („Zapisywanie…” wisi) | **D66** |
| ŚREDNI | zdjęcia: bez zmniejszania, limit 10 MB, HEIC, osierocone pliki | **D67** |
| ŚREDNI | błąd odczytu = pusta lista („0 zleceń”, „Brak zdjęć”, brak „Spakowane x/y”) | **poprawione** e21162f |
| ŚREDNI | wygasła sesja: zapytania jako anon, RLS zwraca puste wyniki bez błędu | **poprawione** 50f0f38 (`021400`: anon bez praw do 89 tabel i 65 sekwencji; przy okazji 3 tabele `migracja_*` bez RLS → **D68**) |
| NISKI | ochrona niezapisanych zmian wyłączona w trakcie zapisu (X / aktualizacja) | **poprawione** df25e7c |
| NISKI | telefon nigdy się sam nie wylogowuje (wspólne telefony) | **D63** |

## Upraszczanie kodu (DRY) — noc 28.11
Analiza (tylko odczyt): `tsc` z `noUnusedLocals` — 0 nieużywanych importów, 0 osieroconych plików; ok. 20 martwych eksportów; 25 grup duplikatów; 15 miejsc, gdzie kopie RÓŻNIĄ SIĘ zachowaniem. Pełna lista refaktorów: `DECISIONS.md` → „Refaktory do rozważenia” (R1–R9), rozjazdy zachowania: D50, D51.

Błędy znalezione przy okazji i poprawione (jako `fix`, nie refaktor):
| Problem | Commit |
|---|---|
| anulowanie: try/catch wokół rpc nic nie łapał — błąd zwolnienia rezerwacji i nogi Bastion ginął; partner bez „kto / kiedy” | b7d7e65 |
| „Zwolniono rezerwacje zlecenia” także po błędzie | af6dceb |
| odmiana „22 zleceń” / „0 zlecenia” w 4 miejscach | 74ae676 |
| zakładanie Titana: błąd oznaczenia grupy ignorowany | 01a3489 |

**Licznik upraszczania** (aktualizowany po każdym refaktorze):
| Commit | Co | Linie |
|---|---|---|
| a977840 | martwe funkcje w `utils.ts` (isOrderOverdue, getOrderTargetProductionDate, formatTodayDDMMYYYY, staTitanMirror*, orderAddonAbsentForE22Lock) | −79 |
| 841fe79 | martwe stałe i typy w 8 plikach | −49 |
| f1f2014 | nieużywana kolumna PILNE i stara funkcja CRM | −50 |
| 7349a64 | nieużywane parametry 3 hooków, scalone importy | −9 |
| 0bae609 | `x && !isReleaseDateEmpty(x)` → `!isReleaseDateEmpty(x)` (6 miejsc) | 0 (prostsze warunki) |
| 38ae994 | `componentOptionLabel` i `formatIlosc` w `lib/magazynFormat` (7 kopii → 1, + test) | −5 kodu (+20 testu) |
| 4d5829a | `CAT_COLORS` / `CAT_LABEL` w `mobile/mobileKategorie` (6 kopii → 1) | −10 |
| 90ee4dd | `fmtDateTime` w `lib/crmFormat` (3 kopie → 1) | −6 |
| (updaterIpc) | typy IPC, `getIpc`, `formatSpeed` w `lib/updaterIpc` (2 kopie → 1, + test) | −21 |
| (daysBetween) | jedno `daysBetween` w `companyStats` (3 kopie → 1, + test) | −16 |
| **Razem** | | **−245 linii kodu aplikacji** (+40 linii testów) |
Zachowanie bez zmian: po każdym kroku `tsc` OK, 720 testów OK, lint bez zmian (83 = 66 ze startu + 17 w pliku z serwera).

## Do decyzji
> Od 28.11 w nocy pełna, uporządkowana lista jest w `DECISIONS.md` (format: problem / opcje / rekomendacja / pilność / praca). Poniżej historyczna lista z rund 1–4.
1. **Gdzie testować z zapisem danych.** Opcje: (a) gałąź Supabase (osobna baza, płatna godzinowo; dane trzeba zasiać skryptem seed), (b) zostać przy trybie bezpiecznym na produkcji (bez seeda i czyszczenia), (c) lokalny Supabase w Dockerze (Docker nie działa na tym komputerze). Koszt gałęzi wg Supabase: **0,01344 USD za godzinę** (ok. 0,32 USD na dobę); projekt nie ma dziś żadnej gałęzi. Gałąź startuje pusta (schemat z historii migracji, bez danych i bez funkcji Edge), więc potrzebny skrypt seed. Rekomendacja: (a) na czas sesji, potem usunąć gałąź.

2. **Porządki starych rezerwacji** (`20261127232100_…superseded.sql`): oznaczyć 16 232 stare anulowane wiersze bez powodu (828 zleceń) jako zastąpione. Nic nie kasuje, nie zmienia stanów; samo podwajanie usuwa już plik 232000. Rekomendacja: wgrać razem z 232000 (porządek w historii, mniej pułapek na przyszłość).
3. **Prognozy magazynowe** (`232800`): po wgraniu do końca grudnia wszystkie komponenty pokażą „za mało danych” (historia od 4.09). Uwaga (runda 4): zmienią się też **Alerty magazynowe** — 32 pozycje (19 dziś krytycznych) przejdą w „brak danych”, a proponowana ilość do zamówienia spadnie do pokrycia ujemnego stanu. Rekomendacja: wgrać — dziś prognoza jest myląca (2 miesiące = „wystarczające dane”).
4. **Reklamacje ↔ Excel**: przy różnych wartościach etapu wygrywa program, więc poprawka inicjałów w Excelu nie dociera. Rekomendacja: zostawić (program = źródło kliknięć), a różnice pokazać w raporcie Weryfikacji (osobne zadanie).
5. **Druga umowa z tej samej oferty**: ten sam numer co projekt czy zawsze nowy? Teraz: ten sam tylko, gdy poprzednia jest projektem; podpisana/anulowana/wysłana — nowy numer. Rekomendacja: tak zostawić. Do tego: czy stary projekt oznaczać jako anulowany (dziś zostaje), czy protokół też ma dostać osobne pliki (dziś nadpisuje — jedna linia).
6. **Numery central w podpisach maili**: dopięcie po telefonie z podpisu łączy maile kilku osób z firmy w jednego klienta. Rekomendacja: dopinać tylko numery komórkowe (9 cyfr zaczynające się od 4–8), stacjonarne pomijać.
7. **Czas realizacji ST / Bastion**: dopóki Excel nie daje dat wydania, liczba opiera się na kilku zleceniach (ST: 1 prawdziwa data). Rekomendacja: pokazywać z licznikiem „N bez prawdziwej daty” (tak jest po poprawce), a w Excelu prosić o datę zamiast „X”.
8. **Pulpit — „aktywne” i „Do wysłania”**: 1818, w tym 797 Technicznych i 177 nóg Disting Plus z wydaną nogą STA. Rekomendacja: „Do wysłania” = zlecenia z ukończonymi etapami; Techniczne osobnym kaflem; wydanie STA zamyka nogę Disting (decyzja z rundy 1, pkt Disting Plus).
9. **Archiwizacja po 12 mies. (`created_at`)** utnie statystyki w czerwcu 2027. Rekomendacja: archiwizować po `release_date` i statystyki liczyć w bazie z `orders` ∪ `orders_archive`.
10. **Pole „Kategoria” w nowym zleceniu** (zapis w innej zakładce z cudzym numerem) i **ręczny dzień produkcji** — czy biuro tego potrzebuje? Rekomendacja: kategoria tylko do odczytu w nowym zleceniu; dzień z listą i podpowiedzią z kartoteki.
11. **Anulowanie Titana z zakładki Bastion** anuluje tylko nogę Bastion. Rekomendacja: pytać „anulować cały zestaw?”.
12. **`orders.updated_at`**: bez tej kolumny nie da się ostrzec „ktoś zmienił zlecenie po otwarciu” (dziś wysyłane są tylko zmienione pola — to samo pole zmienione przez dwie osoby nadal: wygrywa ostatni). Rekomendacja: dodać kolumnę z triggerem w następnym etapie.

13. **Korekta 7 ram** (`233100`): zwrot na BUKOWA ram zdjętych mimo etapu „nie dotyczy” (5 zleceń ST). Rekomendacja: wgrać razem z 233000.
14. **Spis z kartki** (dostawa w trakcie znika ze stanu): blokować PZ/MM/zdjęcia na magazynie z otwartym spisem czy liczyć różnicę od godziny liczenia? Rekomendacja: ostrzeżenie + godzina liczenia na kartce.
15. **Zmiana receptury na zleceniach w produkcji**: przeliczać tylko niezrobione etapy także tam, gdzie coś już zeszło? Rekomendacja: tak, w jednej funkcji bazy.
16. **MM towaru zarezerwowanego**: przenosić rezerwacje razem z towarem czy blokować przesunięcie ponad wolny stan? Rekomendacja: pytanie w MM „przenieść też rezerwacje”.
17. **Klient ze sklepu**: oznaczać jako wygranego po samym potwierdzonym zamówieniu czy po wpłacie? Rekomendacja: po potwierdzeniu (porządki już go nie zamykają).
18. **Klient wracający po przegranej**: przywracać jego odrzucone oferty do „wysłanej”? Rekomendacja: tak, oferty odrzucone przy przegranej.
19. **Odstąpienie od podpisanej umowy**: dziś trigger blokuje każdą zmianę podpisanej. Rekomendacja: dopuścić tylko „podpisana → anulowana” z potwierdzeniem, gdy będzie potrzebne.
20. **Pliki PDF przy usuwaniu klienta** (RODO): dodać polityka DELETE / kasowanie w funkcji serwerowej? Rekomendacja: tak.

## Migracje do wdrożenia na produkcję
1. ✅ już wgrane (regresja): `supabase/migrations/20261127221000_crm_bez_decyzji_po_wyniku_v2.sql`
2. ✅ już wgrane (regresja): funkcja Edge `crm-mail-sent` v18 (kod w repo)
3. ⏳ `supabase/migrations/20261127223000_reklamacje_excel_scalanie_etapow.sql` — scalanie etapów reklamacji z Excelem
4. ⏳ `supabase/migrations/20261127224000_crm_polacz_leady_etykiety_zamowienia_firma.sql` — łączenie klientów CRM
5. ⏳ `supabase/migrations/20261127225000_crm_porzadki_bez_przyszlych_zadan.sql` — nocne porządki CRM
6. ⏳ `supabase/migrations/20261127230000_cofanie_etapu_na_wydanym.sql` — cofanie etapu na wydanym zleceniu
7. ⏳ `supabase/migrations/20261127231000_zd_anulowanie_po_czesciowym_przyjeciu.sql` — anulowanie ZD po częściowym przyjęciu
8. ⏳ funkcja Edge `crm-dokumenty` (repo) — umowy: 0 zł, numer po sprawdzeniu braków
9. ⏳ funkcja Edge `crm-call-ingest` (repo) — mail do klienta po numerze z podpisu, sklejone numery (po wgraniu skopiować też do OneDrive `supabase/functions/crm-call-ingest`)
10. ⏳ funkcja Edge `excel-sync` (repo) — ANULOWANE w kolumnie etapu (przed wgraniem porównać repo z wersją v16 na serwerze)
11. ⏳ `supabase/migrations/20261127232000_rezerwacje_przywroc_bez_podwajania.sql` — **KRYTYCZNE**, „Przywróć” nie podwaja rezerwacji
12. ⏳ `supabase/migrations/20261127232100_rezerwacje_stare_bez_powodu_superseded.sql` — **po decyzji** (Do decyzji pkt 2), po 11
13. ⏳ `supabase/migrations/20261127232200_rezerwacja_pomija_anulowane.sql` — **KRYTYCZNE**, anulowane bez nowych rezerwacji
14. ⏳ `supabase/migrations/20261127232300_anulowanie_zlecenia_zwalnia_rezerwacje.sql` — trigger, po 11 i 13
15. ⏳ `supabase/migrations/20261127232400_numeracja_zlecen_odporna_na_literowki.sql`
16. ⏳ `supabase/migrations/20261127232500_magazyn_ilosci_bez_nan.sql` — dodaje `check` na stanach i ruchach (dziś 0 wierszy NaN — sprawdzić tuż przed wgraniem)
17. ⏳ `supabase/migrations/20261127232600_stat_zew_braki_czas_realizacji.sql`
18. ⏳ `supabase/migrations/20261127232700_reguly_terminow_bez_duplikatow.sql` — kasuje zdublowane reguły id 5–8
19. ⏳ `supabase/migrations/20261127232800_prognozy_pelne_miesiace.sql` — po decyzji pkt 3 (zalecane)
20. ⏳ `supabase/migrations/20261127233000_nd_etap_nie_wydawany_przy_wydaniu.sql` — **KRYTYCZNE**
21. ⏳ `supabase/migrations/20261127233100_korekta_nd_ramy_zwrot.sql` — **po decyzji** (pkt 13), po 20
22. ⏳ `supabase/migrations/20261127233200_drzwi_wew_wydanie_bez_ruchow_zniszczen.sql`
23. ⏳ `supabase/migrations/20261127233300_anulowane_bez_wydania_i_wysylki.sql` — po 22
24. ⏳ `supabase/migrations/20261127233400_crm_etykiety_numer_oferty_uprawnienia.sql`
25. ⏳ `supabase/migrations/20261127233500_crm_umowa_podpisana_bez_zmian.sql`
26. ⏳ **PILNE** `supabase/migrations/20261127234000_pilne_anon_bez_funkcji.sql` — samodzielny, można wgrać od razu (i ponownie po całości)
27. ⏳ `supabase/migrations/20261127234100_rezerwacja_i_weryfikacja_bota_tylko_kierownik.sql`
28. ⏳ `supabase/migrations/20261127234200_kierownik_dzialu_zakres_kategorii.sql`
29. ⏳ `supabase/migrations/20261127234300_magazyn_stany_tylko_przez_funkcje_audyt.sql`
30. ⏳ `supabase/migrations/20261127234400_etap_nd_na_wydanym_bez_przywracania.sql` — po 233000
31. ⏳ `supabase/migrations/20261127234500_konta_crm_tylko_superadmin.sql`
32. ⏳ `supabase/migrations/20261127235000_wydane_zlecenie_bez_nowych_rezerwacji.sql`
33. ⏳ `supabase/migrations/20261127235100_nd_na_anulowanym_bez_przywracania.sql` — po 233000 (gdyby 233000 poszło później — puścić 235100 jeszcze raz)
34. ⏳ `supabase/migrations/20261128000000_teczka_zkp_zlecenie_produkcyjne.sql` — **KRYTYCZNE dla ZKP**
35. ⏳ `supabase/migrations/20261128000100_zkp_protokol_ocena_od_nowa.sql` — **KRYTYCZNE dla ZKP**
36. ⏳ `supabase/migrations/20261128000200_zkp_okucia_wypelnienia_po_potwierdzeniu.sql`
37. ⏳ `supabase/migrations/20261128010000_powiadomienia_superadmin_bez_zablokowanych.sql`
38. ⏳ `supabase/migrations/20261128010100_wzmianki_tylko_oznaczeni_raz.sql` — po 37
39. ⏳ `supabase/migrations/20261128010200_slownik_bezpiecznik_receptury_wykluczenia.sql`
40. ⏳ `supabase/migrations/20261128010300_przywracanie_z_archiwum_zdjecia_bez_powiadomien.sql`
41. ⏳ `supabase/migrations/20261128010400_storage_zdjecia_zalaczniki_bez_listowania.sql`
42. ⏳ `supabase/migrations/20261128010500_audyt_szablony_wykluczenia_wymiary.sql`
43. ⏳ `supabase/migrations/20261128020000_alu_etap_oczekiwana_liczba_sztuk.sql` (przed albo razem z 1.1.8; aplikacja bez niej działa jak dotąd)
44. ⏳ `supabase/migrations/20261128021000_wydanie_etapu_nie_na_wstrzymany.sql`
45. ⏳ `supabase/migrations/20261128021100_zd_pozycje_tylko_w_szkicu.sql`
46. ⏳ `supabase/migrations/20261128021200_zkp_deklaracja_blokada_kart.sql`
47. ⏳ `supabase/migrations/20261128021300_bastion_partia_blokada.sql`
48. ⏳ `supabase/migrations/20261128021400_anon_bez_tabel.sql` — razem z D1 (`234000`), samodzielny
49. ⏳ `supabase/migrations/20261128021500_excel_zla_data_nie_wywraca_paczki.sql` — po `20261127223000`; Edge `excel-sync` do wdrożenia razem
50. ⏳ `supabase/migrations/20261128021600_numeracja_bez_obcinania_lpad.sql` — **przed setną umową w roku** (licznik 2026 = 71)
51. ⏳ `supabase/migrations/20261128022000_alu_cofniecie_oczekiwana_liczba_sztuk.sql` (jak 43; aplikacja bez niej działa jak dotąd)
Po wgraniu: `scripts/kontrola-po-wdrozeniu.sql` (pusty wynik = OK). Próba generalna (runda 5): pliki do 233500 przechodzą razem w kolejności nazw, w jednej transakcji. Twarde zależności: 232000+232200 przed 232300; 232100 po 232000; 233100 po 233000; 233300 po 233200; 234400 po 233000.
Pliki 225000, 232200 i 232700 zmienione w rundzie 4 (nadal niewgrane). 232000 + 232200 + 232300 wgrywać razem.
Pliki 3–7 zostały w rundzie 3 poprawione (nadal niewgrane). Funkcje Edge 8–10 mają w rundzie 3 kolejne zmiany w repo — wgrywać najnowszą wersję z repo.
Kolejność dowolna (zmiany niezależne); 3–7 to podmiany pojedynczych funkcji z kontrolą „już poprawione”.
(migracje z 27.11 przed sesją są wgrane, lista w `TESTY_AGENTOW_27-11.md`, część 7)
