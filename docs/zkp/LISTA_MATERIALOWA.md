# Lista materiałowa zlecenia (zestawienie materiałowe, ZKP 5.9)

Plik „Lista materiałowa" z programu Aluron (`.xls`/`.xlsx`) importowany w szczegółach
zlecenia aluminium: **Lista materiałowa → + Importuj listę materiałową (.xls)** (kierownik).

- Parser: `src/lib/aluMaterialListParser.ts` (SheetJS 0.20.3 z CDN SheetJS — wersja z npm
  0.18.5 ma CVE-2023-30533). Czyta numer zlecenia i datę z wiersza „Zlecenie: … Utworzono: …",
  grupy, pozycje (kod, nr GM, opis, ilość, j.m., cena, wartość, potrzeba, potrzeba bez odpadów),
  sprawdza sumy „Razem:" grup i „Razem wartość materiału bez rabatu". Test na próbce
  OF348/2026: `src/__tests__/aluMaterialListParser.test.ts`.
- Przed zapisem okno z podsumowaniem; ostrzeżenie, gdy numer zlecenia w pliku różni się od
  numeru zlecenia w programie (duplikat „ (2)" traktowany jak ten sam numer).
- Migracja `migrate/zkp_04_lista_materialowa.sql`:
  - rodzaj dokumentu `LM`, bucket `order-documents` przyjmuje też `.xls`/`.xlsx`;
  - `zkp_material_lists` (nagłówek, 1:1 z wersją dokumentu LM) i `zkp_material_list_items`
    — tylko odczyt, bez UPDATE/DELETE, audyt nagłówka, retencja 10 lat (`zkp_*`);
  - `zkp_import_material_list` — w jednej transakcji nowa wersja dokumentu LM i pozycje
    (nieudany import nie zostawia wpisu w teczce);
  - teczka: pozycja 4 „Zestawienie materiałowe" = bieżąca LM, a gdy jej brak — LP.
- Nowa wersja listy = nowa wersja dokumentu LM z własnymi pozycjami; poprzednia zostaje
  (ZKP 5.1.6). Wycofanie bieżącej wersji przywraca poprzednią jako bieżącą.

Testy lokalne (Postgres 18 z atrapami, zkp_00…zkp_04 po kolei): brak uprawnień, puste
pozycje, pozycja bez kodu, ilość jako tekst, zlecenie spoza aluminium → błąd; nieudany import
nie zostawia dokumentu; v1/v2 z pozycjami; teczka LM przed LP, po wycofaniu v2 → v1; audyt
i retencja.

Dalej: przyjęcia komponentów krytycznych (etap F) podpowiadają pozycje z bieżącej listy
materiałowej zlecenia.
