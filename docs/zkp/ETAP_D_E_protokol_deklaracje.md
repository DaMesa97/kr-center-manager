# ZKP AS 75EI — etap D+E: protokół badań 6.17.5, deklaracje KDWU / DWU (6.9), tabliczka 6.26 / etykieta 6.8

> Baza: `migrate/zkp_07_protokol_deklaracje.sql` (wgrana 30.10). Źródła: zał. 6.17.5 (wzór A–G, tabela K),
> 6.9 (wykaz i wzory deklaracji, strony 2–3), 6.26 (tabliczka), 6.8 (etykieta B / CE), księga pkt 5.7.

## Protokół badań wyrobu gotowego (6.17.5)

**Gdzie:** karta wyrobu → część **G. Protokół 6.17.5** (dostępna po potwierdzeniu zakresu). Kod:
`src/components/zkp/ZkpProtocolSection.tsx`, `src/lib/zkpProtocol.ts`, wydruk `src/lib/zkpPrintDocs.ts`.

- Jeden protokół na konstrukcję, **numer = numer konstrukcji**; po WSTRZYMANIU i naprawie nowy, kompletny protokół `…/2`, `…/3`.
- **A** identyfikacja z karty (typ, skrzydła, otwieranie, zakres, ewakuacja), data produkcji / kontroli, przyrządy (nr z 6.14).
- **B / D / E / F** — 5 + 8 + 7 + 2 sprawdzeń jak we wzorze, wynik OK / NOK (n/d tam, gdzie wzór dopuszcza).
- **C pomiary** — nominały z karty (ościeżnica: z LP, do poprawy), zmierzone wpisuje kontroler, **wynik liczy baza**
  (`zkp_protocol_eval`): ościeżnica ±2 mm, przekątne ≤ 3 mm, skrzydła ±2 mm i limity tabeli K (szer./wys./pow., sumy
  dla 2-skrz.), nad-/doświetle (niedopuszczone w S-zakresach), grubość G w zakresie i jak w karcie, szczeliny A/B/C na
  trzech krawędziach ≤ limit zakresu, masa ≤ 350 kg. Wiersze z oceną kontrolera: wymiary wypełnienia, próg, zawiasy
  (liczba sprawdzana automatycznie wg h), trzpienie.
- **Kontroler** — inicjały osoby z uprawnieniem `kontrola_odbiorcza` w matrycy 6.27 (`zkp_assert_competency`); konto hali
  może wpisywać (`zkp_can_record_card`).
- **G decyzja** (Pełnomocnik / Zastępca): ZGODNY / NIEZGODNY (rejestr 6.20) + ZWOLNIONY / WSTRZYMANY.
  Jedno NOK w B–F → baza nie pozwoli na ZWOLNIONY. ZWOLNIONY **zamyka kartę wyrobu** (cz. F: nr protokołu, data,
  podpis z serwera). WSTRZYMANY → karta otwarta, nowy protokół. NIEZGODNY + WSTRZYMANY → karta zamknięta jako niezgodna.
- Ręczne „zwolniony" w cz. F jest zablokowane bez zwolnionego protokołu (`zkp_decide_card`); zostało tylko „NIEZGODNY — zamknij bez zwolnienia".
- Wydruk PDF w układzie wzoru (A–G, tabela pomiarów z kryteriami).

## Deklaracje właściwości użytkowych (6.9)

**Gdzie:** ZKP → **Deklaracje (6.9)**. Kod: `src/components/zkp/ZkpDeclarationsPanel.tsx`, hook `useZkpDeclarations`.

- Do zlecenia; jedna deklaracja = konstrukcje **tego samego kodu typu (6.8)** ze zwolnionymi kartami i bez deklaracji
  (`zkp_declaration_candidates`, okno „Wystaw" grupuje zlecenie × typ).
- Numer nadaje baza z licznika per rodzaj i rok: **KDWU/RR/NNNN** (drzwi wewnętrzne, znak B) / **DWU/RR/NNNN** (zewnętrzne, CE).
- Wartości z karty: klasa (EI2 30 / EI2 60 / NPD dla S), dymoszczelność (S200 / Sa4 albo NPD), zdolność do zwolnienia
  (ewakuacja), wysokość (największa z wybranych ± 2 mm), DWU: wodoszczelność wg wariantu (7A / 4A / 2A / 3A), C2, kl. 2,
  uderzenie i UD z ustawień (domyślnie NPD — do czasu dokumentów z zał. 6.7 cz. C).
- **Ustawienia** (⚙, PJ / Zastępca / admin, `zkp_settings`): nr certyfikatu krajowego (AC 158) i CE (NB 2310), sprawozdania LTB,
  ODT, konstrukcje mocujące, podpisujący (imię, stanowisko), UD / uderzenie. Puste = kropki na wydruku + ostrzeżenie w zakładce.
- Numer deklaracji **wraca do kart** (rejestr 6.33, teczka). Wycofanie z powodem: numer zostaje w historii, karty wolne pod nową.
- Wydruki: deklaracja (KDWU — strona 2 wzoru, DWU — strona 3), **tabliczki 6.26 + etykiety B / CE 6.8** po jednej stronie A5 na konstrukcję.

## Teczka (alu_dossier_status)

„Protokół badań" = jest, gdy każda aktywna konstrukcja ma protokół zamknięty ZWOLNIONY; „Deklaracja" = jest, gdy każda ma numer.
Blokada wydania zlecenia ZKP działa dalej na tej samej liście.

## Test (transakcja z ROLLBACK, `scratchpad/test_zkp_07.sql`)

Karta kompletna → ręczne zwolnienie = odmowa → protokół z NOK (szczelina A 8 > 7) → zwolnienie = odmowa → WSTRZYMANY →
protokół `/2` bez NOK → ZWOLNIONY → karta zamknięta z numerem → kandydaci → `KDWU/26/0001` → numer w karcie → teczka 9/10 →
druga deklaracja na tę samą konstrukcję = odmowa → wycofanie → karta wolna → `KDWU/26/0002`. Zgodne.

## Do potwierdzenia z PJ

- Nominał ościeżnicy w protokole: podpowiadany z wymiaru konstrukcji w LP (szer./wys. zewnętrzna) — czy to właściwa baza do ±2 mm?
- Czy trzpienie w zakresie S (opcjonalne) mają w protokole „n/d", gdy ich nie ma (dziś: kontroler wybiera n/d).
- Układ tabliczki: wzór DWG systemodawcy (6.26 „[wstawić rysunek]") — dziś tabela pól na A5; grawer dostanie dane, nie rysunek.

## Na później

- Zlecenie produkcyjne 6.30 z LP, samokontrola 6.16.5 przy etapach, B2 etykiety elementów cięcia (czeka na LC AS 75EI).
- Protokół montażu 6.28 jako formularz (dziś PDF do teczki).
- Rejestr niezgodności 6.20 (dziś numer wpisywany ręcznie w protokole / karcie).
