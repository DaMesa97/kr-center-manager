# ZKP AS 75EI — etap F: zakładka w aplikacji

> Baza etapu F: `migrate/zkp_03_przyjecia.sql` (wgrana 26.10). Ten etap to interfejs nad
> jej funkcjami — zapis wyłącznie przez `zkp_*` (role ZKP, kwarantanna, dostawcy pilnowane w bazie).

## Gdzie

Menu boczne → **ZKP AS 75EI** (widzą osoby z dowolną rolą ZKP na koncie oraz admin — admin bez
ról ZKP ma podgląd). Kod: `src/components/zkp/`, `src/hooks/useZkp.ts`, `src/lib/zkp.ts`.

| Podzakładka | Załącznik | Kto zapisuje |
|---|---|---|
| Przyjęcia i partie | 6.24 | przyjęcie / uzupełnienie: Magazyn, Pełnomocnik, Zastępca · decyzja o kwarantannie: Pełnomocnik, Zastępca |
| Dostawcy kwalifikowani | 6.31 | Pełnomocnik, Zastępca |
| Komponenty krytyczne | 6.10.5 | Pełnomocnik, Zastępca |

## Zachowanie

- **Przyjęcie**: dostawca tylko z wykazu (niekwalifikowani widoczni, ale nie do wyboru), komponent tylko z listy
  6.10.5; nr katalogowy podpowiada model z listy, rodzaj dokumentu — wymagany dokument dostawcy. Brak nr partii
  albo dokumentu jakości (nr lub skan) → okno ostrzega, a baza zapisuje **kwarantannę**.
- **Skan dokumentu jakości** (PDF/JPG/PNG) → bucket `zkp-documents` (`przyjecia/RRRR/…`), bez kasowania;
  „📎 skan” otwiera podpisany link w przeglądarce.
- **Kwarantanna**: „Uzupełnij” (partia/dokument/skan — nie zwalnia) i „Decyzja…” (przyjąć / zwrot,
  uzasadnienie min. 3 znaki; przyjęcie zablokowane bez nr partii i dokumentu).
- **Dostawcy**: status Kwalifikowany / Niekwalifikowany / spoza wykazu (jak `zkp_supplier_is_qualified`),
  termin następnej oceny (czerwony po terminie, pomarańczowy ≤ 30 dni), historia ocen po kliknięciu wiersza.
  Oceny tylko dopisywane.
- **Komponenty krytyczne**: domyślnie tylko lista 6.10.5; „+ Krytyczny” po wyszukaniu w kartotece.

Test obiegu na bazie (w transakcji z ROLLBACK, tymi samymi parametrami co `useZkp.ts`): komponent na listę →
dostawca na wykaz + ocena wstępna → przyjęcie bez partii = kwarantanna wymuszona → uzupełnienie → decyzja PJ
(podpis z serwera) — zgodne.

## Świadomie na później

- **Wydruk rejestru 6.24 / wykazu 6.31** w układzie załączników — potrzebne wzory załączników.
- **Wydanie partii na zlecenie (RW)** — etap B4 (obieg magazynowy aluminium).
- Import przyjęć z pliku (kolumny `source` / `source_document_path` są już w bazie).
