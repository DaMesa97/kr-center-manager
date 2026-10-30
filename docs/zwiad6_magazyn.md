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

## P2 — zrobione (`migrate/zwiad6_p2_magazyn.sql` + UI)

- „W drodze" odświeża się po przyjęciu dostawy (`onPoAfterAction`).
- Ruchy: lista = ostatnie 500 z informacją i przyciskiem „Wczytaj starsze" (+500, `range()` zamiast `limit()`).
- Stan na dzień: `fetchAllPages` na RPC (wszystkie magazyny > 1000 wierszy).
- Smart: zużycie netto ≤ 0 (ZWR ≥ WZ) = `manual`, ręczne progi zostają (dziś 8 SKU smart, żadnego 1/1 — zabezpieczenie).
- Stany pokazują próg MIN ze smart (🤖) i liczą status od tego samego progu co Komponenty / Zamawianie.
- Alerty: propozycja zamówienia raz na SKU (61 SKU miało ją na 2 półkach; suma 51 118 → 51 050), liczniki pigułek po SKU.

- Prognozy: historia zużycia przy < 3 WZ pokazuje prawdziwe ruchy (flaga „za mało danych" i prognoza 0 zostają) — `migrate/zwiad6_p2b_prognozy.sql`.

## P2 — do zrobienia

- Draft ZD nie liczy się do „w drodze" → Zamawianie proponuje zamówić drugi raz to, co już jest w szkicu (decyzja: pokazywać szkice osobno jako „w szkicu"?).
- Receptura 520 (ST / Skrzydło / ST68 TERMO / ANTRACYT): komponent to skrzydło 80P, a kryterium i nazwa mówią „90E / PRAWE" (duplikat 522) → powinno być 80N. 3 otwarte zlecenia 80N PRAWE są w `no_recipe`. Gotowy skrypt naprawczy (kryterium + nazwa + rezerwacja tych 3 zleceń) czeka na uruchomienie przez Tymka: `migrate/fix_recipe_520_data.sql` (albo ręcznie w Recepturach: szerokość 90E → 80N i „Przelicz rezerwacje ST").
- Pola „policzono" edytowalne dla wszystkich, RPC tylko kierownik (decyzja: magazynier spisuje?).
- ~~Brak UI do `undo_damage_report`~~ → Ruchy: przycisk „Cofnij" przy ZN (kierownik), znika po cofnięciu (ruch ZWR-ZN-id).
- Oczekiwane części receptur `wing/frame/hardware` na sztywno (757 zleceń Disting w `partial_recipe`) — decyzja per kategoria.

## Decyzje dla Tymka

1. ~~Czy magazynier ma spisywać inwentaryzację?~~ **Decyzja 30.10 (Tymek):** magazynierzy liczą na wydrukowanych kartkach, do komputera wprowadza kierownik → zakładka zostaje tylko dla kierownika, bez zmian.
2. ~~Oczekiwane części receptur per kategoria~~ **Decyzja 30.10:** Disting ma ościeżnicę, ale produkowaną inaczej i bez śledzenia stanów → tylko skrzydło. ST: skrzydło + ościeżnica (receptury ościeżnic ST będą). STA: wszystkie trzy. Tabela `warehouse_expected_parts` (`migrate/zwiad6_p3_czesci_szkice.sql`); zmiana = INSERT/DELETE w tabeli, bez UI.
3. ~~Alerty: rozdzielić nadrezerwację od wyczerpania?~~ **Decyzja 30.10:** NIE. Zlecenia schodzą w ~2 tygodnie, więc rezerwacje to realne bliskie zużycie — „dostępne po rezerwacjach" jest właściwą miarą. Smart gate zostaje 4 dni.
4. ~~Szkice ZD~~ → Zamawianie pokazuje „w szkicu ZD: X" obok propozycji (informacyjnie, nie odejmuje); `get_incoming_stock_per_component.r_draft_qty`.
