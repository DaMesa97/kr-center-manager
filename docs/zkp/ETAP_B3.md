# ZKP AS 75EI — B3: teczka zlecenia

> ZKP 5.9 (komplet dokumentów zlecenia przez 10 lat), ZKP 5.1.6 / zał. 6.34
> (zabezpieczenie przed utratą i nieuprawnioną zmianą, bez usuwania).

## 1. Co się zmieniło

| Zmiana | Odwołanie |
|---|---|
| Dokumenty mają **wersje**: nowa LP/LC/ZM nie nadpisuje i nie kasuje poprzedniej (koniec `UNIQUE(order_id, kind)`) | ZKP 5.1.6 |
| Dokument można tylko **wycofać z powodem** — zostaje w teczce jako wycofany | zał. 6.34 |
| Brak kasowania: zdjęte polityki DELETE/UPDATE na `order_documents` i na plikach w buckecie `order-documents` | pkt 10.4 briefu |
| Migawka autora dokumentu (`uploaded_by_name`) — usunięcie konta nie gubi „kto dodał" | pkt 10.1 |
| Nowe rodzaje: zamówienie klienta (ZK), zamówienie materiałów (ZMAT), protokół montażu (MONT), inny | ZKP 5.9 |
| **Zlecenie ZKP** = pozycja z systemem „75EI"/„75 EI" albo ręczne oznaczenie kierownika (auto / tak / nie) | pkt 1.6 briefu |
| **Lista teczki** jest / brak / nie dotyczy dla 11 dokumentów z ZKP 5.9 (generowane przez program — zlecenie, PZ, RW, karta, protokół, deklaracja — na razie „brak", dojdą w etapach C–F) | ZKP 5.9 |
| „Nie dotyczy" (zamówienie klienta, zamówienia materiałów, protokół montażu) tylko PJ / Zastępca / KP, z powodem; cofnięcie też z powodem | ZKP 5.3.2 |
| **Blokada wydania** zlecenia ZKP z niekompletną teczką (komunikat z listą braków); zwykłe aluminium bez zmian | ZKP 5.9 |
| W aplikacji: panel „Teczka zlecenia" w szczegółach zlecenia aluminium — lista teczki, historia wszystkich wersji (otwórz / wycofaj), dodawanie PDF do teczki | — |

## 2. Migracja

`migrate/zkp_02_teczka.sql` — przetestowana na lokalnym Postgresie 18 (dwukrotne
uruchomienie, wersje, wycofanie, nowe rodzaje, zdjęte polityki, rozpoznanie ZKP,
„nie dotyczy" z rolami, stan teczki, blokada wydania).

⏳ **Do wgrania** (konektor zablokowany przez klasyfikator uprawnień — decyzja właściciela).
Migracja jest bezpieczna dla już zainstalowanych wersji aplikacji: stare wersje dostają
od bazy pustą „starą ścieżkę", więc przestają kasować poprzednie pliki.

⚠️ **Najpierw migracja, potem wydanie aplikacji** — nowa wersja woła funkcje teczki.

## 3. Test dla właściciela (po migracji i wydaniu)

1. Zlecenie aluminium → szczegóły → **Nowa wersja listy cięcia** → w „Teczce" widać LC v1 i v2,
   v2 „aktualny", v1 nadal do otwarcia.
2. **Wycofaj…** na v2 z powodem → v2 szara „wycofany: …", bieżąca znów v1; przycisk
   „Otwórz listę cięcia" otwiera v1.
3. **ZKP: tak (AS 75EI)** → pojawia się lista teczki, czerwone „brakuje N — wydanie zablokowane";
   próba wydania zlecenia → komunikat z listą braków.
4. Konto z rolą ZKP „Kierownik Produkcji" → przy „Protokół montażu" **Nie dotyczy…** z powodem →
   stan „nie dotyczy", kto i kiedy; konto bez roli ZKP nie widzi przycisku.
5. **Dodaj do teczki** → Zamówienie klienta → PDF → pozycja „Zamówienie klienta" = jest.

## 4. Świadomie na później

- **Eksport teczki dla audytora (ZIP / PDF ze spisem treści)** — ma sens, gdy w teczce będą
  dokumenty generowane przez program (karta, protokół, deklaracja: etapy C–E).
- Rozpoznanie AS 75EI po nazwie systemu do potwierdzenia na próbce LP AS 75EI.
