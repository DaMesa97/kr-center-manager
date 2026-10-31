# Zwiad #7 — hala: pracownik 55–65 lat, który „tylko klika etapy" (2026-10-31)

Pięciu zwiadowców przeszło program wyłącznie po kodzie (bez logowania), każdy w innej roli:

| Zwiadowca | Rola | Raport |
|---|---|---|
| Zbyszek | 63 l., frezarka STA (E2.1/E2.2), wspólny PC, słabo widzi, dwuklika | [zwiad7/zbyszek.md](zwiad7/zbyszek.md) |
| Halina | 61 l., pakowanie (E4/E5), pracuje w dużej tabeli „jak w Excelu" | [zwiad7/halina.md](zwiad7/halina.md) |
| Andrzej | 58 l., brygadzista ościeżnic regulowanych Bastion, prowadził arkusz NOWE i Reszta | [zwiad7/andrzej.md](zwiad7/andrzej.md) |
| Rysiek | 64 l., montaż, chodzi po hali, telefon z Androidem, dziurawe Wi-Fi | [zwiad7/rysiek.md](zwiad7/rysiek.md) |
| Wdrożeniowiec | onboarding kont, język komunikatów, dostępność, odporność, plan przejścia z Excela | [zwiad7/wdrozenie.md](zwiad7/wdrozenie.md) |

Fakty z bazy (31.10): 5 kont `pracownik_produkcji`, wszyscy STA (DK e1+e5, KS e3+e5, KW e3+e4+e5, MK e2_1+e2_2, TC e4+e5), kierownik działu PP. Logują się **tylko z Electrona na Windows, na wspólnych komputerach stanowiskowych**. Zero logowań z telefonu przez 60 dni. Bastion / ST / Disting nie mają jeszcze żadnego konta pracownika.

Najcięższe zarzuty zweryfikowane ręcznie w kodzie po zwiadzie (okno Electrona, login po wylogowaniu, zapis w tabeli, rozmiar komórki, build mobilny, licznik bezczynności) — potwierdzone.

---

## Co już działa dobrze (zgodnie wszyscy)

- **Moje stanowisko**: pracownik ląduje od razu na swojej liście, posortowanej „co najpierw" (XX → X → gotowe → pilne → data), czekające schowane.
- **Kafelki „Kto zrobił?"**: klik w swój kafelek = potwierdzenie, ostatnia osoba podświetlona, blokada drugiego kliku w trakcie zapisu.
- **Pasek „Cofnij" przez 60 s** po oznaczeniu, z numerem zlecenia i inicjałami, ze zwrotem ZWR.
- **Baza pilnuje**: `update_order_stage` z guardem, wydanie z magazynu idempotentne (dwuklik nie robi dwóch WZ), realtime chroni świeży klik przed nadpisaniem przez 15 s.
- **Błędy po polsku** w jednym miejscu (`friendlyError.ts`), błędy wiszą 10 s, błąd sieci przy logowaniu nie zużywa limitu prób.
- Partie Bastion wyglądają jak arkusz NOWE, Reszta podświetla wiek 7/14 dni jak Excel.

---

## P1 — to zablokuje seniora albo da złe dane

Zdublowane znaleziska scalone; w nawiasie, kto je zgłosił.

| # | Problem | Gdzie | Poprawka | Koszt |
|---|---|---|---|---|
| 1 | **Okno Electrona startuje 800×600, nie zmaksymalizowane**, z angielskim menu (Ctrl+W zamyka program, Ctrl+Shift+I DevTools). Przy sidebarze 280 px na tabelę zostaje ~520 px. (Zbyszek, Halina, Wdroż.) | `electron/main.ts:442-447` | `win.maximize()` po utworzeniu, `autoHideMenuBar`/własne menu, zapamiętany `zoomFactor` + Ctrl+plus/minus/0. | S |
| 2 | **Klik w tabeli STA/Disting/Bastion zapisuje inicjały ZALOGOWANEGO KONTA bez pytania „kto" i bez potwierdzenia.** Na wspólnym PC zalogowanym na MK Zbyszek wpisuje „MK". Moje stanowisko ma kafelki, tabela nie. (Zbyszek, Halina, Wdroż.) | `useOrders.ts:617-651`, `StaDistingOrdersTableView.tsx:195-213`, `BastionOrdersTableView.tsx:122-130` | Dla `pracownik_produkcji` w tabelach ten sam `StageWorkerConfirmDialog` (osoby z `worker_stages` dla etapu); przy jednej osobie — bez dialogu. Alternatywa: pracownik nie widzi tabel (tryb prosty). | M |
| 3 | **Po wylogowaniu login kolegi zostaje w polu** (czyszczone tylko hasło). Zbyszek wpisuje swoje hasło pod cudzym loginem → po 5 próbach **blokuje cudze konto na 15 min**. Błąd logowania tylko jako toast, brak autofocusu, brak „pokaż hasło". (Zbyszek, Wdroż.) | `useAuth.ts:131`, `App.tsx:162-207` | `setLoginUsername('')` przy SIGNED_OUT; stały tekst błędu pod formularzem; `autoFocus`; „pokaż hasło". Docelowo kafelki ostatnich osób tego PC. | S |
| 4 | **Komórki nie-swoich etapów wyglądają identycznie jak swoje** — dopiero po kliknięciu toast „Możesz oznaczać tylko przypisane Ci etapy" w rogu ekranu. (Halina, Andrzej) | `App.tsx:759-771`, `StaDistingOrdersTableView.tsx:196-214`, `BastionOrdersTableView.tsx:120-143` | Przekazać `myAssignedStageKeys` do tabel, `disabled` + klasa `--foreign` (kropkowana ramka, cursor default), nagłówki swoich etapów podświetlić. | S |
| 5 | **Etapy w tabeli STA są ~29.–34. kolumną z 46**, w Bastion ~27. Na 1366 i na 1920 px E4/E5 są poza ekranem — każdy klik etapu to przewinięcie ~1000 px i utrata widoku modelu/koloru. (Halina, Andrzej) | `StaDistingOrdersTableView.tsx:321-409`, `BastionOrdersTableView.tsx:204-292`, `orderTableColumns.tsx` | Dla pracownika produkcji `...stageCols` zaraz po FIRMIE; albo etapy `sticky` z prawej. | S |
| 6 | **Dwuklik w „✓ Zrobione"**: drugi klik trafia w overlay (dialog znika, „nic się nie stało") albo w kafelek pod kursorem (etap na przypadkową osobę). Tytuł dialogu „Oznaczyć etap jako zrobiony?" jest sr-only — na ekranie nie ma słowa „zrobione"; dialog nie pokazuje firmy/modelu/wymiaru. (Zbyszek) | `StageWorkerConfirmDialog.tsx:46-82`, `MyStationView.tsx:271-281, 479-485`, `App.css:2694-2704` | Ignorować kliki przez ~400 ms od otwarcia; nie zamykać na klik w tło; widoczny tytuł 20 px; druga linia `firma · model · S×W · ilość`. | S |
| 7 | **Rozmiary**: komórka etapu 32×32 px / 12 px, „✓ Zrobione" to `btn-sm` ~27–30 px / 13 px, tabela 13,6 px, plakietki 11 px, badge ZREALIZOWANE 9 px. Pusta vs zrobiona komórka różni się tylko odcieniem (tło 1,02:1), inicjały 3,9:1 (< AA). Brak trybu dużej czcionki. (wszyscy) | `App.css:168-172, 2964-3005, 2045-2058, 4774-4781` | Klasa `app--large` (domyślna dla `pracownik_produkcji`, przełącznik w nagłówku, localStorage): font 17–18 px, komórka 44×44 / 15 px, „Zrobione" jako `.btn` min 44 px, kafelki 120 px, zrobione = ciemniejsza zieleń + ✓. | S |
| 8 | **Licznik bezczynności nie widzi klikania etapów** (`touchSession` 0× w Moim stanowisku i hookach Bastion) — wylogowanie w środku pracy zależy od odświeżenia tokena, nie od tego, czy ktoś pracuje. Modal: „Sesja wkrótce wygaśnie", właściwy przycisk czerwony. (Zbyszek, Wdroż.) | `useAuth.ts:9-10, 145-162`, `SessionWarningModal.tsx:29-40` | Globalny `pointerdown/keydown` → `touchSession()` (throttle 30 s). Tekst: „Nikt nic nie klikał od godziny. Za 60 s program się wyloguje. Pracujesz dalej?" — zielony „TAK, PRACUJĘ". | S |
| 9 | **Bastion: UI mówi „możesz", baza „nie".** `canMark = isManager \|\| rola PP`, a `bastion_batch_can_mark()` wymaga `worker_stages` z kategorią Bastion. Pracownik bez przypisania klika i dostaje czerwony toast. „Skręć całą partię" bez etapu OŚĆ SKR. = N toastów (pętla nie przerywa). (Andrzej, Wdroż.) | `App.tsx:3834, 3852, 3861`, `BastionBatchesPanel.tsx:182-198`, `bastion_partie.sql:68-78` | `canMark` z `workerStagesForCurrent` (kategoria Bastion); `canScrew` po kluczu `oscieznica_skrecanie`; przerwać pętlę po pierwszym błędzie. | S |
| 10 | **WorkerStagesModal nie zna etapów partii (`panele_*`, `opaski_*`) ani Reszty (`osc_cnc`, `osc_skrecanie`, `kontrola`, `stolarnia`)**; baza wpuszcza każdego z dowolnym etapem Bastion do wszystkich etapów partii/Reszty. Partie i Reszta zapisują inicjały zalogowanego bez kafelków i nie ma ich na Moim stanowisku. (Andrzej, Wdroż.) | `WorkerStagesModal.tsx:29-46`, `bastion_partie.sql:69-77`, `bastion_reszta.sql:139`, `BastionBatchesPanel.tsx:149-155`, `BastionExtrasPanel.tsx:93-99` | Sekcje „Bastion — partie" i „Bastion — Reszta" w modalu; dialog kafelków przed `onSetStage`; docelowo zadania partii/Reszty w `buildTasks` (Moje stanowisko). | S + M |
| 11 | **Brygadzista Bastionu nie doda pozycji Reszty ani nie utworzy partii** (RPC `assert_manager_or_service`). W Excelu robił to sam. Naklejka / zrealizowane / kolejność — też tylko kierownik. (Andrzej) | `bastion_reszta.sql:91,116,165`, `bastion_partie.sql:191,221,242`, `BastionExtrasPanel.tsx:138`, `BastionBatchesPanel.tsx:270` | **Decyzja Tymka.** Technicznie: guard `bastion_batch_can_mark()` w create/add/remove i w Reszcie (delete zostaje kierownik), w UI `isManager` → `canMark`. | S |
| 12 | **Kierownik działu nie może założyć konta** — zakładka Użytkownicy tylko dla admina. Wdrożenie Bastion/ST/Disting wisi na Tymku. (Wdroż.) | `src/utils.ts:196`, `useUsers.ts:55, 90-99` | Użytkownicy dla `isManagerRole`; KD widzi/edytuje tylko konta PP w swoich kategoriach. **Decyzja.** | S |
| 13 | **Telefon: wersja mobilna praktycznie nie istnieje w sieci.** To osobny build (`mobile.html`), lokalny `dist-mobile` z **16.06.2026** (bez Cofnij, kafelków, reklamacji), `release.mjs` go nie buduje, brak hostingu w repo. Gest „wstecz" Androida wyrzuca z aplikacji; manifest bez PNG i bez service workera; błędy znikają po 2,5 s w tym samym dymku co sukces; każde obudzenie ekranu = spinner na całej liście; liczby wymiarów 13,6 px z etykietą 10 px. (Rysiek) | `MOBILE.md:21-33`, `scripts/release.mjs`, `MobileStationView.tsx:106-123, 241-245, 459-483`, `manifest.webmanifest`, `mobile.css` | **Decyzja: czy w ogóle telefon/tablet.** Jeśli tak: hosting + `build:mobile` w release, `pushState` dla dialogów, PWA (PNG 192/512, `start_url: /mobile.html`, SW), błędy sticky + pasek offline, ciche odświeżanie, duże liczby. Werdykt Ryśka: **tablet 10" w uchwycie przy stole** jako pilotaż, telefon później. | M (1 dzień + hosting) |

## P2 — wkurzy albo zmyli

- **Pomyłkowy klik w tabeli** zapisuje i od razu wydaje towar; popup cofnięcia nie mówi, które zlecenie i który etap cofa, straszy „ruchem ZWR"; pracownik może skasować **cudze** inicjały bez informacji czyje. → treść „Cofnąć etap E5 w zleceniu 7154? Wpis „KW" zostanie usunięty.", ZWR drobnym drukiem / tylko kierownik; ostrzeżenie przy cudzych inicjałach. (Halina, Zbyszek, Andrzej)
- **Dwuklik w pustą komórkę tabeli** = dwa wywołania `release_stock_for_stage` (`setProductionStageUpdating` dopiero po `await runStockRelease`). Baza jest idempotentna, ale blokadę ustawić na początku, zdjąć w `finally`. (Zbyszek, Halina, Andrzej)
- **Po 60 s nie ma jak cofnąć ze stanowiska**; w tabeli cofanie bez limitu. → `UNDO_MS` 5 min + sekcja „Ostatnio zrobione (dziś)" z „Cofnij". **Decyzja**: jak długo pracownik sam cofa.
- **Konflikt dwóch osób** na tym samym etapie: RPC nie sprawdza stanu poprzedniego, ostatni nadpisuje, obie „sukces". → `where coalesce(production_stages->>key,'')=''` gdy value≠'' + toast „już oznaczył XX".
- **„Czeka na poprzednie"** = wyszarzony przycisk bez wyjaśnienia na co czeka. → napis „Czeka na E1".
- **Nic nie mówi „to zadanie jest następne"**. → plakietka NASTĘPNE na pierwszym gotowym wierszu sekcji.
- **Sukces widać 3,5 s w prawym dolnym rogu 14 px**, nad FAB-em „Zgłoś uwagę" — niezauważalne z odległości. W tabeli po oznaczeniu nie ma żadnego toastu. → dla PP toasty góra-środek, 18 px, 6 s; „Zapisano: 7154 · E5 · KW".
- **Brak paska „brak internetu" na desktopie** (jest tylko na mobile). Po błędzie zadanie zostaje i nikt nie wie, czy klikać ponownie. → baner „Brak internetu — poczekaj, program sam się połączy".
- **Dialog „Wydaj mimo braku"** („stan na minus", „inwentaryzacja", czerwony przycisk) to decyzja magazynowa zrzucona na frezera. → dla PP: „Magazyn pokazuje brak części. Zrobiłeś etap — kliknij **Zrobione mimo to**; kierownik dostanie informację." **Decyzja**: kto o tym decyduje.
- **Realtime przesuwa tabelę**: nowe zlecenie wskakuje NA GÓRĘ, wydane znika bez komunikatu. → dla PP INSERT na koniec; toast „Zlecenie 7154 wydane — przeniesione do zrealizowanych".
- **Szukajka** nie czyści się przy zmianie zakładki, bez „×", długi placeholder; Ctrl+K niewidoczne i przestawia filtry na stałe. → `type="search"`, czyścić przy zmianie zakładki, „Wpisz numer zlecenia".
- **Stany specjalne etapów** (X / nie dotyczy, wstrzymane, 2 szt.) — niemożliwe, obejście to komentarz, którego w kolumnie nie widać. → menu na kafelku (prawy klik / przytrzymanie). **Decyzja.**
- **Partie pamiętają tylko „do"** (jedna data per etap), brak „ile dni trwała". **Decyzja po rozmowie z Andrzejem** (start/koniec vs tylko koniec + „(N dni)").
- **Formularz Reszty: 13 pól** na „próg BOLD 150 szt. 2"; podpowiedzi widać dopiero po wpisaniu litery. → 8 kafelków ze słownika nad opisem, rzadkie pola pod „Więcej…". Prompt o notatkę przy tworzeniu partii: „Anuluj" anuluje całą partię.
- **PILNE wygląda na klikalne** (disabled checkbox), checkbox etykiet / badge magazynu / 💬 w komórce NR to szum dla PP. → dla PP tekst „PILNE", bez etykiet i StockStatusBadge.
- **Onboarding**: założenie pracownika z 3 etapami = 2 okna, ~12 kliknięć; brak „skopiuj od…"; brak kontroli unikalności inicjałów (statystyki liczą po inicjałach!). Hasło: brak walidacji min. 6 przy tworzeniu. → sekcje tylko z kategorii pracownika, „Skopiuj od…", ostrzeżenie o duplikacie.
- **Pomoc/INSTRUKCJA** nie opisują kafelków, paska Cofnij, okna braków. → sekcja w 5 krokach = ściąga A4.
- **Żargon** do wycięcia z tekstów dla hali: sesja, synchronizacja, powiązany, pozycja, komponent, ZWR, identyfikator, serwer, odśwież, administrator. Pełna tabela brzmień w [zwiad7/wdrozenie.md](zwiad7/wdrozenie.md).
- **Mobile (jeśli wchodzi)**: `appConfirm` na telefonie nigdy się nie rozwiązuje (brak `AppDialogHost` w `MobileApp`) — kosz zdjęć w Pakowaniu nic nie robi (**bug**); „Wyloguj" 31×31 px bez potwierdzenia; PP widzi Pakowanie i Zlecenia; `user-scalable=no`; brak wibracji; toast na belce nawigacji.

## P3 — kosmetyka

Ekran „skacze" ze STA na Moje stanowisko przy starcie; zakładka Etykiety i FAB dla frezera; trzy nazwy programu (System Zamówień / KR Center Manager Produkcji / KR Center Manager); brak `prefers-reduced-motion`, focus tylko na `.btn`; sortowanie po kliknięciu w nagłówek etapu i resize kolumn (zapis w localStorage na stałe) dostępne dla PP; dwa poziome paski przewijania; brak jednorazowego dymka „tu nie wpisujesz liter — klikasz Zrobione, potem swój kafelek"; „Brak inicjałów" raz toast, raz prompt.

---

## Propozycja kolejności (bez czekania na decyzje)

**Tura 1 (S, ~1 dzień, nic nie wymaga decyzji):** #1 okno Electrona + zoom; #3 login; #4 obce komórki wyszarzone; #6 dialog „Zrobione" (tytuł, dane zlecenia, ochrona przed dwuklikiem); #8 licznik bezczynności + tekst modala; #9 `canMark` Bastion + guard skręcania; blokada dwukliku w tabeli; teksty popupu cofania; baner offline na desktopie; „Czeka na E1"; plakietka NASTĘPNE; sekcje partii/Reszty w WorkerStagesModal; kafelki w Partiach/Reszcie; walidacja hasła; bug `AppDialogHost` na mobile.

**Tura 2 (po decyzjach):** #2 kafelki w tabelach / tryb prosty; #5 etapy po FIRMIE dla PP; #7 `app--large`; #11 uprawnienia brygadzisty; #12 Użytkownicy dla kierownika działu; stany specjalne; okno cofania; „Wydaj mimo braku"; toasty dla PP.

**Tura 3:** partie/Reszta na Moim stanowisku; daty start/koniec partii; mobile (hosting, PWA, wstecz, offline) albo tablet przy stole.

## Tryb prosty — najtańszy wariant (Wdrożeniowiec)

Flaga `profiles.simple_mode` albo automat `role === 'pracownik_produkcji' && workerStages.length > 0`. Zakładki: Moje stanowisko + Pomoc (+ Bastion do czasu partii/Reszty w zadaniach). Bez Ctrl+K, bez OverdueBanner, bez Etykiet. Klasa `app--simple` na `.app-layout`: font 18 px, komórka 44 px, duże przyciski, kafelki 130 px, toasty góra-środek. Kafelki „kto zrobił" zawsze. Electron zmaksymalizowany. Koszt S (1 dzień) + M na kafelki w tabelach.

## Plan przejścia z Excela (Wdrożeniowiec)

1. **Kolejność działów**: Disting (ci sami ludzie co STA, mirror) → ST (Titan) → Bastion ostatni (3 miejsca klikania; najpierw #9/#10/#11).
2. **Konta**: rekomendacja **konto stanowiskowe** (`stan.bastion.cnc`, PIN 6 cyfr, rola PP, kategoria, `worker_stages` stanowiska) + osoby jako profile z unikalnymi inicjałami na tych samych etapach → kafelki. Nikt poza stanowiskowym nie zna hasła, auto-wylogowanie na takich kontach zbędne.
3. **Ściąga A4 przy stanowisku** (8 punktów): program jest zalogowany — nie wylogowuj; znajdź numer jak w Excelu; „✓ Zrobione"; kafelek ze SWOIMI inicjałami; pomyłka — „Cofnij" przez minutę, potem kierownik; okno „brakuje…" → „Zrobione mimo to" + powiedz kierownikowi; aktualizacja → „Pobierz" i czekaj; problem → „Zgłoś uwagę" albo kierownik.
4. **2 tygodnie równolegle**: program źródłem prawdy od dnia 1, Excel uzupełnia kierownik wieczorem z programu; porównanie Statystyki → Produktywność z arkuszem = lista brakujących etapów = rozmowa z konkretną osobą.
5. **Pomiar** już jest: `audit_log` (filtr użytkownika, „Ukryj systemowe"), Produktywność per osoba/kategoria/zakres dat. Brakuje widoku „etapy dopisane hurtem > 1 dzień po poprzednim".

---

## Do decyzji Tymka

1. **Model kont na stanowisku**: każdy własne konto (wtedy szybkie przełączanie osoby, #3) czy **konto stanowiskowe + kafelki** (rekomendacja; wtedy kafelki także w tabelach, #2, i bez auto-wylogowania).
2. **Czy pracownik produkcji w ogóle widzi tabele kategorii**, czy tylko Moje stanowisko (tryb prosty jako domyślny dla roli)? Od tego zależy #2, #4, #5.
3. **Bastion — co wraca do brygadzisty**: tworzenie partii i dokładanie zleceń, dodawanie pozycji Reszty, naklejka / zrealizowane, kolejność produkcji (#11).
4. **Daty partii**: tylko koniec etapu (jak dziś) czy od–do — po rozmowie z Andrzejem w poniedziałek.
5. **Stany specjalne etapów** (nie dotyczy / wstrzymane / 2 szt.): menu na kafelku teraz czy „2 szt. = komentarz".
6. **Cofanie**: jak długo pracownik cofa sam (60 s / 5 min / do końca zmiany / zawsze jak dziś w tabeli) i czy może kasować cudze inicjały.
7. **„Wydaj mimo braku"** — decyduje frezer na hali czy kierownik/magazyn (powiadomienie).
8. **Kierownik działu zakłada konta i resetuje hasła?** (#12)
9. **Telefon/tablet na hali**: hosting wersji mobilnej (Cloudflare Pages / Netlify) i pilotaż tabletem przy stole okuwania, czy zostajemy przy PC.
10. **Unikalność inicjałów** wymusić w profilach (statystyki liczą po inicjałach).
11. Duża czcionka: automatycznie dla roli PP czy przełącznik per komputer.
