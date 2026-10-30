# Zwiad #6 — moduł magazynowy „jak user" (2026-10-30)

Pięciu skautów przeszło magazyn jak magazynier / kierownik (przyjęcia, rezerwacje,
receptury, inwentaryzacja, wydania, alerty, smart). Poniżej co znaleźli i co z tym zrobiono.

## P1 — psuło dane albo blokowało pracę (naprawione, `migrate/zwiad6_p1_magazyn.sql`)

| # | Objaw | Naprawa |
|---|-------|---------|
| 1 | Dwa komputery przyjmowały tę samą pozycję ZD (stan 20 przy zamówionych 10). | `receive_purchase_order`: pozycja już przyjęta w całości / zamknięta → błąd „odśwież"; klient wysyła `expected_received` (ile widział) → niezgodność = błąd; nadwyżka ponad zamówienie tylko po potwierdzeniu (kod `P0401` → appConfirm w `PurchaseOrderReceiveModal`); „nic nie przyjęto" = błąd zamiast sukcesu i zmiany statusu ZD; pozycja spoza ZD = błąd; magazyn musi być aktywny. |
| 2 | Przywrócenie anulowanego zlecenia podwajało rezerwacje (828 zleceń miało wiersze cancelled z edycji + z anulowania). | `stock_reservations.cancel_reason` (`order_cancelled` / `superseded` / `manual`). Edycja zlecenia (`useWarehouse`) i przeliczenie kategorii → `superseded`, ręczne zwolnienie → `manual`. `restore_order_reservations` przywraca tylko `order_cancelled` (stare wiersze bez powodu: tylko ostatnią paczkę anulowania, okno 2 s) i przelicza `stock_status` zlecenia. Nowy wrapper `cancel_order_reservations(p_order_id, p_reason)`. |
| 3 | Pusta receptura (kryteria, 0 pozycji) wygrywała dopasowanie; część zostawała bez rezerwacji bez śladu. | `match_recipes_for_order` pomija receptury bez pozycji; `CHECK (quantity > 0)` na pozycjach receptur. |
| 4 | Komponent dezaktywowany w kartotece dalej był rezerwowany z receptur (146 kandydatów). | `reserve_stock_for_order`: nieaktywny komponent → issue `inactive_component` (status `partial_recipe`, widoczny w badge i w szczegółach wysyłki); blokada `FOR UPDATE` na zleceniu; qty ≤ 0 pomijane. UI: usunięcie komponentu będącego w aktywnej recepturze zablokowane z listą receptur. |
| 5 | Zamknięcie inwentaryzacji przekraczało limit 8 s (pełny spis 25 s, 42 korekty 8,4 s). | `close_inventory_session__impl`: przeliczenie braków zleceń raz po pętli (zbiór zleceń dla wszystkich korekt), bez `match_recipes_for_order` per zlecenie. Pomiar: 478 korekt 3,0 s, 42 korekty 1,1 s. |
| 6 | `release_stock_for_stage` / `release_remaining_for_order` bez kontroli uprawnień. | Guard: etap → `can_write_order_stage(p_order_id)`; wydanie końcowe → `assert_warehouse_perm('movements')` (kierownik / magazynier, zgodnie z UI). |

Dorzucone tanie P2: unikalny indeks `inventory_lines(session_id, component_id)` (duplikat księgował korektę 2×);
trigger `BEFORE DELETE` na `stock_reservations` koryguje `reserved_quantity` (kaskada z usunięcia zlecenia zostawiała fantomy).

Test: `scratchpad/p1/test_p1.sql` (transakcja z rollback) — wszystkie scenariusze przeszły przed wgraniem.

## P2 — do zrobienia

- Draft ZD nie liczy się do „w drodze" → Zamawianie proponuje zamówić drugi raz to, co już jest w szkicu.
- „W drodze" nie odświeża się po przyjęciu dostawy.
- Ruchy: limit 500 wierszy bez informacji; Stan na dzień: limit 1000 (PostgREST) bez `fetchAllPages`.
- Smart: komponent ze ZWR ≥ WZ dostaje min 1 / target 1 i nadpisuje ręczne progi; Prognozy pokazują zero historii przy < 3 WZ.
- Stany ignorują progi smart (Komponenty i Zamawianie już je pokazują).
- Alerty: target mnożony przez liczbę magazynów; licznik liczy wiersze, nie SKU.
- Receptura 520: kryterium powinno być 80N (do potwierdzenia z Tymkiem).
- Pola „policzono" edytowalne dla wszystkich, RPC tylko kierownik (decyzja: magazynier spisuje?).
- Brak UI do `undo_damage_report`.
- Oczekiwane części receptur `wing/frame/hardware` na sztywno (757 zleceń Disting w `partial_recipe`) — decyzja per kategoria.

## Decyzje dla Tymka

1. Czy magazynier ma spisywać inwentaryzację (dziś tylko kierownik zamyka, ale pola edytuje każdy)?
2. Oczekiwane części receptur per kategoria (Disting bez `hardware`?).
3. Alerty: rozdzielić „nadrezerwacja" (rezerwacje > stan) od „wyczerpanie" (stan < min)?
