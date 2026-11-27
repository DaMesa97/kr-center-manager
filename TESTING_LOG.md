# TESTING_LOG — sesja testów KR Center (start 27.11.2026, ok. 20:30)

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

## Do decyzji
1. **Gdzie testować z zapisem danych.** Opcje: (a) gałąź Supabase (osobna baza, płatna godzinowo; dane trzeba zasiać skryptem seed), (b) zostać przy trybie bezpiecznym na produkcji (bez seeda i czyszczenia), (c) lokalny Supabase w Dockerze (Docker nie działa na tym komputerze). Koszt gałęzi wg Supabase: **0,01344 USD za godzinę** (ok. 0,32 USD na dobę); projekt nie ma dziś żadnej gałęzi. Gałąź startuje pusta (schemat z historii migracji, bez danych i bez funkcji Edge), więc potrzebny skrypt seed. Rekomendacja: (a) na czas sesji, potem usunąć gałąź.

2. **Porządki starych rezerwacji** (`20261127232100_…superseded.sql`): oznaczyć 16 232 stare anulowane wiersze bez powodu (828 zleceń) jako zastąpione. Nic nie kasuje, nie zmienia stanów; samo podwajanie usuwa już plik 232000. Rekomendacja: wgrać razem z 232000 (porządek w historii, mniej pułapek na przyszłość).
3. **Prognozy magazynowe** (`232800`): po wgraniu do końca grudnia wszystkie komponenty pokażą „za mało danych” (historia od 4.09). Rekomendacja: wgrać — dziś prognoza jest myląca (2 miesiące = „wystarczające dane”).
4. **Reklamacje ↔ Excel**: przy różnych wartościach etapu wygrywa program, więc poprawka inicjałów w Excelu nie dociera. Rekomendacja: zostawić (program = źródło kliknięć), a różnice pokazać w raporcie Weryfikacji (osobne zadanie).
5. **Druga umowa z tej samej oferty**: ten sam numer co projekt czy zawsze nowy? Teraz: ten sam tylko, gdy poprzednia jest projektem; podpisana/anulowana/wysłana — nowy numer. Rekomendacja: tak zostawić. Do tego: czy stary projekt oznaczać jako anulowany (dziś zostaje), czy protokół też ma dostać osobne pliki (dziś nadpisuje — jedna linia).
6. **Numery central w podpisach maili**: dopięcie po telefonie z podpisu łączy maile kilku osób z firmy w jednego klienta. Rekomendacja: dopinać tylko numery komórkowe (9 cyfr zaczynające się od 4–8), stacjonarne pomijać.
7. **Czas realizacji ST / Bastion**: dopóki Excel nie daje dat wydania, liczba opiera się na kilku zleceniach (ST: 1 prawdziwa data). Rekomendacja: pokazywać z licznikiem „N bez prawdziwej daty” (tak jest po poprawce), a w Excelu prosić o datę zamiast „X”.
8. **Pulpit — „aktywne” i „Do wysłania”**: 1818, w tym 797 Technicznych i 177 nóg Disting Plus z wydaną nogą STA. Rekomendacja: „Do wysłania” = zlecenia z ukończonymi etapami; Techniczne osobnym kaflem; wydanie STA zamyka nogę Disting (decyzja z rundy 1, pkt Disting Plus).
9. **Archiwizacja po 12 mies. (`created_at`)** utnie statystyki w czerwcu 2027. Rekomendacja: archiwizować po `release_date` i statystyki liczyć w bazie z `orders` ∪ `orders_archive`.
10. **Pole „Kategoria” w nowym zleceniu** (zapis w innej zakładce z cudzym numerem) i **ręczny dzień produkcji** — czy biuro tego potrzebuje? Rekomendacja: kategoria tylko do odczytu w nowym zleceniu; dzień z listą i podpowiedzią z kartoteki.
11. **Anulowanie Titana z zakładki Bastion** anuluje tylko nogę Bastion. Rekomendacja: pytać „anulować cały zestaw?”.
12. **`orders.updated_at`**: bez tej kolumny nie da się ostrzec „ktoś zmienił zlecenie po otwarciu” (dziś wysyłane są tylko zmienione pola — to samo pole zmienione przez dwie osoby nadal: wygrywa ostatni). Rekomendacja: dodać kolumnę z triggerem w następnym etapie.

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
Pliki 3–7 zostały w rundzie 3 poprawione (nadal niewgrane). Funkcje Edge 8–10 mają w rundzie 3 kolejne zmiany w repo — wgrywać najnowszą wersję z repo.
Kolejność dowolna (zmiany niezależne); 3–7 to podmiany pojedynczych funkcji z kontrolą „już poprawione”.
(migracje z 27.11 przed sesją są wgrane, lista w `TESTY_AGENTOW_27-11.md`, część 7)
