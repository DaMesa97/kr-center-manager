# ZKP AS 75EI — krok 0 (fundament) + B1 (numer konstrukcji)

> Decyzje właściciela z 26.10.2026: konta na hali zostają współdzielone (etapy = inicjały,
> zatwierdzenia ZKP robią PJ/KP na własnych kontach); dane aluminium trzymamy 10 lat;
> ZZ = jeden licznik wszystkich zleceń aluminium; komponenty krytyczne przez magazyn
> Marklowicka; montaż Producenta „czasem" (pole na pozycji, etap C); kopia miesięczna → Dropbox MR Profil.

## 1. Co się zmieniło

| Zmiana | Odwołanie |
|---|---|
| Retencja: cron czyszczący audyt nie rusza zapisów aluminium (zlecenia, pozycje, dokumenty, konstrukcje) | zał. 6.34, ZKP 5.1.6 |
| Archiwizacja nie przenosi zleceń Aluminium (wcześniej kasowała je z `orders` → kaskadowo pozycje) | ZKP 5.9 |
| Audyt (kto/kiedy z serwera) na pozycjach i dokumentach aluminium | pkt 10.1 briefu |
| Role ZKP na koncie: Pełnomocnik, Zastępca, Kierownik Produkcji, Kontroler, Magazyn — w formularzu użytkownika, zmienia tylko admin | ZKP 5.3.2, pkt 10.2 |
| Uruchomienie zlecenia do produkcji (przycisk w szczegółach zlecenia aluminium) — nadaje kolejny numer zlecenia w roku (ZZ) i numer `RRRR/ZZ/PP` każdej sztuce | ZKP 5.9 |
| Numer niezmienny, nie wraca do puli: zmniejszenie ilości / usunięta pozycja / anulowane zlecenie → status „anulowana", numer zostaje; nowe sztuki → kolejne PP | ZKP 5.9 |
| Uruchomionego zlecenia nie da się skasować (klucz obcy RESTRICT) | ZKP 5.9, pkt 10.4 |
| Pole etykiety `{{alu_nr_konstrukcji}}` na etykiecie sztuki | ZKP 5.9 (numer na elementach w toku) |

## 2. Migracje — uruchom w tej kolejności (SQL Editor)

1. `migrate/zkp_00_fundament.sql`
2. `migrate/zkp_01_numer_konstrukcji.sql`

Obie są bezpieczne do ponownego uruchomienia; na końcu każdej jest zapytanie kontrolne.
Przetestowane na lokalnym, jednorazowym Postgresie 18 (atrapy tabel produkcyjnych):
kryterium odbioru z briefu, zmiany ilości, usuwanie pozycji, anulowanie/przywracanie,
brak uprawnień, próba skasowania, archiwizacja, retencja, role ZKP — wszystko zgodne.

⚠️ **Najpierw migracje, potem wydanie aplikacji.** Nowa wersja zapisuje `zkp_roles`
przy edycji użytkownika — bez kolumny w bazie zapis profilu by się wywalił.

⚠️ **Czyszczenie bazy przed startem:** licznik ZZ to tabela `alu_order_counters`.
Jeśli testowo uruchomisz zlecenie teraz, dostanie `2026/01`. Przy czyszczeniu bazy
wyczyść też `alu_order_counters`, `alu_production_orders`, `alu_constructions`
(w tej kolejności: konstrukcje → uruchomienia → licznik), inaczej pierwsze prawdziwe
zlecenie nie dostanie numeru 01.

## 3. Test dla właściciela (po migracjach i wydaniu)

1. **Role ZKP:** Użytkownicy → edycja dowolnej osoby → sekcja „Role ZKP (AS 75EI)".
   Jako admin zaznacz np. „Kontroler" → zapisz → otwórz ponownie: zaznaczone.
   Kierownik (nie admin) widzi checkboxy wyszarzone.
2. **Kryterium z briefu:** zaimportuj LP zlecenia z 3 pozycjami, w tym jedna z ilością 2.
   Szczegóły zlecenia → **▶ Uruchom do produkcji** → potwierdź.
   Oczekiwane: „Nr zlecenia (ZKP)" = `2026/01`, numery konstrukcji `2026/01/01` … `2026/01/04`.
   Drugie zlecenie po uruchomieniu zaczyna od `2026/02/01`.
3. **Nowa wersja LP** z mniejszą ilością w pozycji: nadmiarowe numery przekreślone
   (najechanie myszą pokazuje powód), nie znikają.
4. **Etykieta:** Etykiety → Szablony → kategoria Aluminium → wstaw pole
   „Alu: nr konstrukcji (RRRR/ZZ/PP)" → podgląd pokazuje `2026/01/01`;
   druk z uruchomionego zlecenia drukuje właściwy numer na każdej sztuce.
5. **Anuluj zlecenie** uruchomione → numery przekreślone; przywróć → wracają.

## 4. Co dalej (B3 → B2 → F → B4+C)

- **B3 teczka:** wersjonowanie dokumentów zamiast nadpisywania (dziś nowa LC/LP kasuje
  poprzednią), wycofanie z powodem zamiast usuwania, lista wymaganych dokumentów
  „jest / brak / nie dotyczy", eksport dla audytora.
- **B2 etykiety elementów cięcia:** wymaga próbki LC zlecenia AS 75EI.
- Nadal potrzebne od właściciela: `as75ei_zakresy.json`, załączniki 6.17.5 / 6.24 /
  6.25 / 6.26 / 6.30 / 6.33, próbki LP/LC/ZM AS 75EI, ścieżka folderu Dropbox na kopie.
