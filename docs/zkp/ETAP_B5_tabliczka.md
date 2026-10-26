# ZKP AS 75EI — wyszukiwarka „od tabliczki" i eksport teczki

> Pytanie z inspekcji (00 TODO przed certyfikacją): *„Pokaż partię uszczelki pęczniejącej od tabliczki
> do faktury"* → tabliczka (6.26) → rejestr 6.33 → karta 6.25 → przyjęcia 6.24 → WZ / faktura.
> Ten etap robi pierwszy krok tej ścieżki: tabliczka → konstrukcja → zlecenie → teczka.

## Wyszukiwarka

ZKP AS 75EI → **Szukaj po tabliczce** (pierwsza podzakładka, tylko odczyt). Kod: `src/components/zkp/ZkpTracePanel.tsx`,
`src/lib/zkpTrace.ts` (rozpoznanie wpisu), `src/lib/aluTraceData.ts` (odczyt z bazy).

| Wpis | Co znajduje |
|---|---|
| `2026/01/03`, `2026-1-3`, „Nr serii: 2026/01/03" | konstrukcję (sztukę) — `alu_constructions` |
| `2026/01` | zlecenie w roku — `alu_production_orders` |
| `OF341/2026`, `341/2026` | zlecenie po numerze OF (duplikaty „ (2)" → wybór) |
| same cyfry | ID zlecenia z kodu QR etykiety |

Wynik: numer i status konstrukcji, zlecenie (klient, nr w roku, LP, termin, status), pozycja (typ, system, wymiary,
kolory, szyby, uwagi), postęp etapów z inicjałami, teczka (jest / brak / nie dotyczy, „otwórz"), wszystkie konstrukcje
zlecenia (klik = przełącz). Sekcja **partii** to na razie opis — wypełni się po etapie B4/C (wydanie partii na konstrukcję).

## Eksport teczki

Przycisk **📦 Eksport teczki (ZIP)** — w wyniku wyszukiwania i w szczegółach zlecenia aluminium (sekcja teczki).
Kod: `src/utils/dossierExportZip.ts`, `src/lib/dossierExport.ts`, `src/lib/zipStore.ts` (ZIP bez kompresji, nazwy UTF-8,
bez nowych zależności).

Paczka `Teczka_OF341-2026_RRRR-MM-DD.zip`:
- `00_Spis_tresci.pdf` — nagłówek zlecenia, stan teczki, numery konstrukcji, lista plików (rodzaj, wersja, kto/kiedy,
  bieżąca / archiwalna / wycofana z powodem); stopka: kiedy, kto, wersja programu;
- `dokumenty/NN_RODZAJ_vX[_WYCOFANY]_nazwa` — **wszystkie wersje**, także wycofane (ZKP 5.1.6). Plik, którego nie da
  się pobrać, nie przerywa eksportu — w spisie „NIE POBRANO PLIKU".

## Na później

- Partie per konstrukcja (B4/C) → w wyszukiwarce i w spisie paczki.
- Skany dokumentów jakości partii (bucket `zkp-documents`) w paczce, gdy partie będą przypięte do zlecenia.
- Dokumenty generowane przez program (6.30, 6.25, 6.17.5, deklaracja, 6.33) — do paczki, gdy powstaną.
