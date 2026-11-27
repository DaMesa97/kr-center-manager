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
_(w toku — runda 1 = wyniki drugiej serii agentów + weryfikacja)_

## Do decyzji
1. **Gdzie testować z zapisem danych.** Opcje: (a) gałąź Supabase (osobna baza, płatna godzinowo; dane trzeba zasiać skryptem seed), (b) zostać przy trybie bezpiecznym na produkcji (bez seeda i czyszczenia), (c) lokalny Supabase w Dockerze (Docker nie działa na tym komputerze). Koszt gałęzi wg Supabase: **0,01344 USD za godzinę** (ok. 0,32 USD na dobę); projekt nie ma dziś żadnej gałęzi. Gałąź startuje pusta (schemat z historii migracji, bez danych i bez funkcji Edge), więc potrzebny skrypt seed. Rekomendacja: (a) na czas sesji, potem usunąć gałąź.

## Migracje do wdrożenia na produkcję
_(brak w tej sesji — migracje z 27.11 wieczorem są już wgrane, lista w `TESTY_AGENTOW_27-11.md`, część 7)_
