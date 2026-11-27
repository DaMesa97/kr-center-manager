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


## Do decyzji
1. **Gdzie testować z zapisem danych.** Opcje: (a) gałąź Supabase (osobna baza, płatna godzinowo; dane trzeba zasiać skryptem seed), (b) zostać przy trybie bezpiecznym na produkcji (bez seeda i czyszczenia), (c) lokalny Supabase w Dockerze (Docker nie działa na tym komputerze). Koszt gałęzi wg Supabase: **0,01344 USD za godzinę** (ok. 0,32 USD na dobę); projekt nie ma dziś żadnej gałęzi. Gałąź startuje pusta (schemat z historii migracji, bez danych i bez funkcji Edge), więc potrzebny skrypt seed. Rekomendacja: (a) na czas sesji, potem usunąć gałąź.

## Migracje do wdrożenia na produkcję
1. ✅ już wgrane (regresja): `supabase/migrations/20261127221000_crm_bez_decyzji_po_wyniku_v2.sql`
2. ✅ już wgrane (regresja): funkcja Edge `crm-mail-sent` v18 (kod w repo)
(migracje z 27.11 przed sesją są wgrane, lista w `TESTY_AGENTOW_27-11.md`, część 7)
