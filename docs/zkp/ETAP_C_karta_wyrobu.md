# ZKP AS 75EI — etap C: karta wyrobu (6.25), rejestr wyrobów (6.33), wydruk rejestru przyjęć (6.24)

> Baza: `migrate/zkp_05_karta_wyrobu.sql` + `migrate/zkp_05b_zakresy_6105.sql` (wgrane 26.10).
> Źródła: zał. 6.25 (wzór karty, tabela K), 6.10.5 (komponenty per zakres), 6.8 (kod typu), księga ZKP pkt 5.9.

## Gdzie

ZKP AS 75EI → **Wyroby i karty (6.33 / 6.25)** — rejestr wszystkich konstrukcji zleceń AS 75EI; klik = karta.
Karta otwiera się też z wyszukiwarki „od tabliczki" (przycisk przy konstrukcji). Kod: `src/components/zkp/ZkpCardModal.tsx`,
`ZkpProductsPanel.tsx`, `ZkpTraceLots.tsx`, `src/hooks/useZkpCards.ts`, `src/lib/zkpCard.ts`, `src/lib/zkpPrint.ts`.

## Karta wyrobu — jedna na konstrukcję RRRR/ZZ/PP

| Część | Co | Kto | Pilnuje baza |
|---|---|---|---|
| A | typ, skrzydła, kierunek, strona, zakres (EI30/EI30S/EI60/EI60S/S), ewakuacja, nad-/doświetle → **kod typu wyrobu** (6.8) | kontroler / KP / PJ / Zastępca / kierownik | kod liczy `zkp_type_code` |
| B | wymiary skrzydeł, nad-/doświetla, masa, grubość G, zawiasy, trzpienie + 4 potwierdzenia (profile, próg, okucia, konstrukcja mocująca) | jw.; **potwierdza PJ / Zastępca / KP** | **tabela K** w `zkp_ranges`, `zkp_card_checks` — potwierdzenie tylko przy wszystkich „zgodne"; po potwierdzeniu A/B zablokowane (cofnięcie z powodem) |
| C | 10 etapów (1–7 z wzoru) z nr kat., **partią**, wynikiem, operatorem (inicjały) | kontroler / KP / PJ / kierownik | dopiero po potwierdzeniu zakresu; etapy K z komponentem (wkłady, uszczelki 3a–3d) — partia **przyjęta** (6.24), właściwego rodzaju, nr kat. **z listy 6.10.5 dla zakresu** (inaczej odmowa: „spoza listy = KWARANTANNA"); regulacja — szczeliny A/B/C ≤ limit zakresu; n/d tylko 3b i 3d |
| D | okucia (9 pozycji wzoru), producent/model, DWU, liczba, warunek, partia | jw. | partia okucia przyjęta |
| E | wypełnienia (czynne/bierne/nadświetle/doświetle), tabela/wiersz, produkt, grubość, wymiary, partia | jw. | grubość w limicie zakresu; partia szkła / wypełnienia przyjęta |
| F | protokół 6.17.5 nr, decyzja, deklaracja KDWU/DWU, data wydania | **Pełnomocnik / Zastępca** | „zwolniony" tylko bez braków (`zkp_card_release_problems`: etapy OK/n-d, zawiasy i trzpienie wg tabeli K, zamek, wymagane wypełnienia); „niezgodny" wymaga nr rejestru 6.20; po decyzji karta zamknięta |

Etapy, okucia i wypełnienia są **dopisywane** (poprawka = nowy wpis, bieżący = najnowszy) — historia jak skreślenie z podpisem.
Kto/kiedy zawsze z serwera; operator to inicjały (konta na hali są wspólne).

**Teczka:** pozycje „Karta wyrobu", „PZ", „RW / partie" = **jest**, gdy wszystkie aktywne konstrukcje zlecenia mają zwolnione
karty (wcześniej „brak" — blokada wydania zlecenia ZKP działa dalej przez ten sam mechanizm).

## Lista 6.10.5 per zakres

`zkp_range_components` (924 wiersze, 207 kodów) wygenerowana skryptem `scripts/zkp-zakresy-6105.mjs` z tekstu zał. 6.10.5
→ `docs/zkp/as75ei_zakresy.json` + `migrate/zkp_05b_zakresy_6105.sql`. Kod jest „na liście" zakresu, gdy występuje w części B–G
pod nagłówkiem „Zakres:" tego zakresu (tabela albo warunki). „…XX" = dowolny kolor. Przykład: U279 dopuszczona w EI60/EI60S/S,
w EI30 odmowa. **Po nowym wydaniu 6.10.5** (np. po odpowiedziach ALURON w sprawie U122 / B315) — wygenerować i wgrać ponownie.

Uwaga: lista obejmuje numery wymienione w tekście (także w warunkach), więc jest „szeroka" — pilnuje komponentów spoza
raportu, ale nie zastępuje doboru wkładu do profilu (to potwierdza się w części B: „profile i wkłady zgodne z tabelami").

## Rejestry

- **6.33 Rejestr wyrobów** (układ własny wg księgi: „konstrukcje, deklaracje, montaż"): nr konstrukcji, zlecenie / nr w roku,
  klient, kod typu, zakres, skrzydło, status karty, protokół 6.17.5, deklaracja, data wydania, montaż (protokół 6.28 w teczce),
  kto zwolnił. Anulowane zostają (przekreślone). Funkcja `zkp_product_register()`, wydruk PDF z filtrem.
- **6.24 Rejestr przyjęć**: wydruk PDF za okres z podzakładki „Przyjęcia i partie" (wszystkie decyzje).
- **Karta 6.25**: wydruk PDF z okna karty (układ wzoru A–F; pola wyboru jako [X] / [ ]).

## Wyszukiwarka „od tabliczki"

Przy wybranej konstrukcji: przycisk **Karta wyrobu (6.25)** i tabela **partii** z karty → przyjęcie 6.24 (dostawca, WZ,
dokument jakości, skan). To odpowiedź na pytanie z inspekcji: tabliczka → 6.33 → 6.25 → 6.24 → WZ / faktura.

## Do potwierdzenia z Tymkiem / PJ

- Kod typu dla zakresu S: `AS75EI-W-S-S-1-–` (klasa „S", odmiana dymoszczelna „S") — 6.8 mówi tylko „w miejscu klasy S".
- Okno techniczne w kodzie typu jako „W".
- Kto ma rolę „kontroler" na wspólnym koncie hali — wtedy hala wpisuje etapy sama.

## Na później

- Protokół badań 6.17.5 (etap D) i deklaracje KDWU/DWU (etap E) generowane z karty — dziś numery wpisuje się ręcznie w cz. F.
- Wydanie partii z ilością (RW, `qty_issued`) — dziś karta wiąże partię z konstrukcją bez ilości.
- Zlecenie produkcyjne 6.30 z karty / LP.
