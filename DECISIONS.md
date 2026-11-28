# DECISIONS — decyzje dla właściciela (sesja testów 27–28.11.2026)

Plik prowadzony na bieżąco w nocy. Każdy punkt: problem → opcje → rekomendacja → pilność → praca.
Wszystkie poprawki z sesji są na branchu `night-testing-2026-11-27` (lokalnie, niewypchnięte). Pliki migracji bazy są w `supabase/migrations/` i **nic z nich nie jest wgrane** — lista i kolejność: `TESTING_LOG.md`, sekcja „Migracje do wdrożenia”.

## Podsumowanie (5 minut przy kawie)

### Pilne
1. **D1 — Luka bezpieczeństwa na produkcji (bez logowania)**: publicznym kluczem z programu można anulować / przywracać rezerwacje magazynowe dowolnego zlecenia. Plik naprawczy — wgrać od razu.
2. **D2 — Rejestracja kont w Supabase**: sprawdzić, czy „Allow new users to sign up” jest wyłączone (jeśli nie — każdy z kluczem z programu zakłada konto i czyta bazę).
3. **D3 — Wgranie pakietu migracji z sesji** (m.in. „Przywróć” podwajające rezerwacje, etap „nie dotyczy” zdejmowany przy wydaniu, wydanie anulowanego zlecenia, uprawnienia kierownika działu). Jednym skryptem, gdy nikt nie pracuje.
4. **D4 — Publikacja aplikacji 1.1.8** („tnij”) — ok. 150 poprawek od 1.1.7; część poprawek aplikacji zakłada wgrane migracje (D3).
5. **D5 — Korekta 7 ram** zdjętych mimo etapu „nie dotyczy” (5 zleceń ST, BUKOWA).
6. **D6 — Porządki 16 232 starych wierszy rezerwacji** (oznaczenie jako zastąpione).
7. **D7 — Prognozy magazynowe**: poprawka zmieni też Alerty (19 krytycznych → „brak danych” do grudnia/stycznia).
9. **D42 — Excel zdejmuje drugi raz towar wydany przed spisem 6.11** (5 zleceń, 280 szt.; zagrożone 277 otwartych zleceń sprzed spisu) — decyzja: czy próg 7.11 liczyć od daty wydania z Excela.
8. **D39 — Wdrożyć poprawkę CRM „Bastion P-110 nie jest na liście kandydatów”** (Twoje zgłoszenie z nocy): handlowiec nie wyceni żadnego Bastiona P-, N-, T-, L-, LUX-, STD- do czasu wdrożenia `crm-oferta`.

### Może poczekać (najważniejsze)
D8 Disting Plus — rezerwacje e3/e4 nigdy niewydawane · D9 jedna reguła „ile zamówić” · D10 MR Profil (numery, magazyn, statystyki) · D11 kierownik działu a Weryfikacja innych kategorii · D12 ceny z konfiguratora widoczne w danych dla hali · D13 Pulpit: „Do wysłania” i Techniczne · D14 spis z kartki a PZ w trakcie · D15 zmiana receptury na zleceniach w produkcji · D16 MM towaru zarezerwowanego · D17 klient ze sklepu → wygrany · D18 klient wracający po przegranej · D19 odstąpienie od podpisanej umowy · D20 pliki PDF przy usuwaniu klienta (RODO) · D21 follow-up po ofercie dla klienta „Zamówił” · D22 reklamacje: poprawka w Excelu a program · D23 druga umowa z tej samej oferty · D24 numery central w podpisach maili · D25 czas realizacji ST/Bastion bez dat z Excela · D26 archiwizacja po 12 mies. · D27 pole „Kategoria” i dzień produkcji w formularzu · D28 anulowanie Titana z zakładki Bastion · D29 `orders.updated_at` · D30 „Oznacz jako wydane” w Wysyłkach a rozchód od 7.11 · D31 magazynier planuje trasy? · D32 szerokość „90” vs „90E” · D33 zakres ościeżnicy przy zabudowie · D34 Techniczne nigdy niewydawane · D35 Weryfikacja zalana · D36 „Ponów do Optimy” bez adresu webhooka · D37 funkcje CRM dla każdego zalogowanego · D38 wzrost dziennika zmian po audycie stanów · D40 edycja ręcznych drzwi wewn. bez transakcji · D41 wydanie przy błędzie zdjęcia z magazynu · D43 anulowanie wydanego zlecenia · D44 nogi Disting po anulowaniu STA · D45 limit 8 s przy ruchach magazynowych · D46 przeliczenie po recepturze · D47 Statystyki 67 MB · D48 `select *` w Wysyłce · D49 trzy indeksy · D50 trzy znaczenia „anulowane” · D51 drobne rozjazdy kopii kodu · D52–D58 ZKP (przed pierwszym zleceniem ZKP: kto wyłącza ZKP, podpisy etapów, kolejność etapów, nowa wersja LP, konstrukcja niezgodna, zlecenia mieszane, przyjęcia) · D59 kto edytuje szablony etykiet · D60 zmiana nazwy w słowniku · D61 eksport teczki ZKP bez kart i protokołów · D62–D67 runda 10 (telefon: kategorie i wspólny telefon, cofnięty etap wraca z Excela, szkice ZD, limit czasu zapisów, zdjęcia).

---

## Pilne

### D1. Luka: rezerwacje magazynowe bez logowania
- **Problem**: funkcje bazy `cancel_stage_reservations__impl` i `restore_stage_reservations__impl` (oraz `recompute_order_stock_status`) mają prawo wykonania dla `anon`. Ktoś z publicznym kluczem (jest w każdej instalacji programu, widać go w F12) wysyła `rpc/...` z numerem zlecenia — rezerwacje etapu znikają albo wracają, stany „wolne”, zamawianie i alerty liczą źle, w dzienniku brak autora. Odtworzone w transakcji cofanej (zlecenie 17384, etap e2_1: anulowano 16, przywrócono 16).
- **Opcje**: (a) wgrać od razu samodzielny plik `supabase/migrations/20261127234000_pilne_anon_bez_funkcji.sql` (odbiera anon 26 funkcji, zostawia tylko funkcje ekranu logowania; sprawdzony w transakcji: anon dostaje „permission denied”, praca kierownika bez zmian); (b) poczekać i wgrać z całym pakietem D3.
- **Rekomendacja**: (a) — plik nie zależy od reszty, tylko odbiera uprawnienia, których program nie używa. Po wgraniu całego pakietu (D3) puścić go jeszcze raz.
- **Pilność**: pilne · **Praca**: mały (wgranie jednego pliku)

### D2. Rejestracja nowych kont w Supabase
- **Problem**: w repo `supabase/config.toml` ma `enable_signup = true`. Konto bez profilu (sprawdzone w transakcji) czyta wszystkie zlecenia, kontrahentów, stany i woła część funkcji. Jeśli na produkcji rejestracja jest włączona, każdy z kluczem z programu może założyć konto.
- **Opcje**: (a) panel Supabase → Authentication → wyłączyć „Allow new users to sign up” (konta zakłada tylko `manage-users`); (b) dodatkowo polityki odczytu oprzeć na „ma profil” zamiast „jest zalogowany” (większa zmiana bazy).
- **Rekomendacja**: (a) od razu, (b) w kolejnym etapie.
- **Pilność**: pilne · **Praca**: mały (a), średni (b)

### D3. Wgranie pakietu migracji z sesji
- **Problem**: ok. 30 plików w `supabase/migrations/2026112722…–2348…` naprawia błędy krytyczne w bazie (podwajanie rezerwacji, „nie dotyczy” zdejmowane przy wydaniu, wydanie i wysyłka anulowanego, NaN w ilościach, numeracja, uprawnienia). Próba generalna: cały zestaw przechodzi w kolejności nazw w jednej transakcji (kilka sekund), wszystkie łatki trafiają.
- **Opcje**: (a) jeden skrypt, jedna transakcja, gdy nikt nie pracuje (triggery na `orders` i `check` na tabelach magazynu chwilowo blokują zapisy), potem `scripts/kontrola-po-wdrozeniu.sql`; (b) partiami.
- **Rekomendacja**: (a). Pliki-decyzje (D5, D6, D7) można wyłączyć — reszta przechodzi bez nich.
- **Pilność**: pilne · **Praca**: mały–średni (wgranie + kontrola)

### D4. Publikacja aplikacji 1.1.8
- **Problem**: produkcja = 1.1.7; na branchu ok. 150 commitów poprawek (wszystkie testy przechodzą). Część poprawek (np. komunikaty P0409/P0410, blokady anulowanych) działa pełniej z wgranymi migracjami.
- **Opcje**: (a) najpierw D3, potem „tnij”; (b) najpierw aplikacja.
- **Rekomendacja**: (a), po przejrzeniu brancha.
- **Pilność**: pilne · **Praca**: mały (publikacja), przegląd zmian — średni

### D5. Korekta 7 ram (plik `20261127233100_korekta_nd_ramy_zwrot.sql`)
- **Problem**: Excel z „--”/„x” w kolumnie etapu i X w WYDANIE zdejmował z magazynu ramy etapu „nie dotyczy” (zlecenia ST 17431, 17437, 17588, 17589, 17625 — razem 7 ram, BUKOWA, stany na minus).
- **Opcje**: (a) wgrać plik (5 ruchów ZWR, stany wracają do 0); (b) poprawić ręcznie po spisie.
- **Rekomendacja**: (a) razem z 233000.
- **Pilność**: pilne · **Praca**: mały

### D6. Porządki starych rezerwacji (plik `20261127232100_…superseded.sql`)
- **Problem**: 16 232 stare anulowane wiersze rezerwacji bez powodu (828 zleceń) — źródło dawnego podwajania. Samo podwajanie usuwa już 232000.
- **Opcje**: (a) wgrać (oznaczenie, nic nie kasuje, nie zmienia stanów); (b) zostawić.
- **Rekomendacja**: (a) — mniej pułapek na przyszłość.
- **Pilność**: może poczekać (ale najlepiej razem z D3) · **Praca**: mały

### D7. Prognozy magazynowe (plik `20261127232800_prognozy_pelne_miesiace.sql`)
- **Problem**: dziś „wystarczające dane” przy 1–2 miesiącach historii, średnia tylko z miesięcy > 0 (np. komponent 470: 860/mies. z jednorazowego nadrobienia). Po poprawce: średnia z pełnych miesięcy, „za mało danych” przy < 3 pełnych miesiącach. Skutek uboczny: Alerty magazynowe — 32 pozycje (19 dziś krytycznych) przejdą w „brak danych”, proponowana ilość do zamówienia spadnie do pokrycia ujemnego stanu, do ok. grudnia/stycznia (historia od 4.09).
- **Opcje**: (a) wgrać jak jest; (b) wgrać, ale przy „za mało danych” zostawić średnią orientacyjną z oznaczeniem (alerty nie gasną); (c) nie wgrywać do stycznia.
- **Rekomendacja**: (b) — uczciwa prognoza bez gaszenia alertów (do zrobienia po decyzji, mała zmiana).
- **Pilność**: pilne (dziś prognoza myli) · **Praca**: mały–średni

### D39. Wdrożenie poprawki `crm-oferta` (Bastion P-110 i inne)
- **Problem**: zgłoszone w nocy — oferta z Bastion P-110 kończy się „nie jest na liście kandydatów”. Przyczyna: prefiltr znał tylko Bastiony A-/B- i ignorował ID produktu w tekście. Poprawione w repo (f1cb07b, test), funkcja na serwerze nadal v29.
- **Opcje**: (a) wdrożyć `supabase/functions/crm-oferta` (6 plików, z repo) i w tej ofercie „Policz od nowa”; (b) do czasu wdrożenia — wycena ręczna.
- **Rekomendacja**: (a) od razu rano. Zmiana dotyczy tylko wyboru kandydatów (lista dla AI), nie cen ani PDF.
- **Przy okazji do wdrożenia (te same zasady, niepilne)**: `optima-ro-import` (cab1bcf — ręczne wydanie nie znika po anulowaniu i przywróceniu RO w Optimie) oraz pozostałe funkcje Edge z listy w TESTING_LOG.
- **Pilność**: pilne · **Praca**: mały

### D42. Excel zdejmuje z magazynu drugi raz towar wydany przed spisem 6.11
- **Problem**: granica „od 7.11 zamknięcie = rozchód” liczy się od DNIA SYNCHRONIZACJI, nie od daty wydania. Wiersz z Excela z wydaniem 2–5.11, który utknął jako „duplikat” i został rozwiązany po 7.11, robi WZ dziś — a spis 6.11 już tego towaru nie widział. Dowód: 5 zleceń STA (14622, 15403, 15612, 15704, 15960) — 83 ruchy WZ z 9.11 i 21.11, 280 szt. (23 wymuszone). Zagrożone dalej: 277 otwartych zleceń sprzed 6.11 (ok. 10,5 tys. szt. w rezerwacjach). Etapy z Excela robią rozchód zawsze, bez progu.
- **Opcje**: (a) próg osobno dla każdego wiersza: data wydania z Excela ≥ 7.11 → rozchód, wcześniejsza → tylko anulowanie rezerwacji (tak samo w `oznacz_wydane_wysylki`, D30); (b) zostawić (próg = dzień synchronizacji) i korygować ręcznie.
- **Rekomendacja**: (a) + korekta ZWR dla tych 5 zleceń (plik do przygotowania po decyzji). Potrzebne potwierdzenie: czy liczy się data wydania z Excela.
- **Pilność**: pilne (każda synchronizacja starych duplikatów dubluje rozchód) · **Praca**: mały–średni

---

## Może poczekać

### D8. Disting Plus — rezerwacje części skrzydła (e3/e4) nikt nie wydaje
- **Problem**: rezerwacje leżą na rekordzie Disting, a etap odhacza STA → 2568 rezerwacji / 7389 szt. wiszą.
- **Opcje**: (a) etap STA zdejmuje też rezerwacje partnera Disting; (b) rezerwacje części skrzydła zakładać na STA.
- **Rekomendacja**: (a) — mniej zmian w danych.
- **Pilność**: może poczekać (zawyża „zarezerwowane”) · **Praca**: średni

### D9. Zaopatrzenie — trzy ekrany, trzy „ile zamówić”
- **Problem**: Stany i Alerty liczą minimum całej firmy osobno na każdym magazynie, ujemne stany wchodzą 1:1.
- **Opcje**: (a) jedna funkcja bazy dla wszystkich ekranów; (b) zostawić, opisać różnice w Pomocy.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: średni

### D10. MR Profil — import RO
- **Problem**: numery `ZLEC/…` z MR zderzą się z KR (unikalny indeks), nieudane RO przepada bez śladu (kursor idzie dalej), towar MR schodziłby z magazynów WEW KR i liczył się w statystykach KR. Dziś MR ma 0 zleceń.
- **Opcje**: (a) przedrostek numeru „MR/” + osobny magazyn + filtr firmy w statystykach; (b) osobna kategoria.
- **Rekomendacja**: (a) + tabela nieudanych RO z ponawianiem (Weryfikacja).
- **Pilność**: może poczekać (do startu MR) · **Praca**: średni–duży

### D11. Kierownik działu a Weryfikacja innych kategorii
- **Problem**: po poprawce uprawnień w bazie kierownik działu może zmieniać tylko swoje kategorie, a Weryfikacja pokazuje mu wszystkie (anulowanie spoza kategorii dostanie odmowę). Runda 8: obaj kierownicy działu (STA) mają po 856 powiadomień „do weryfikacji”, z czego 742 (87%) dotyczy innych kategorii; reklamacje też idą do wszystkich.
- **Opcje**: (a) Weryfikacja i powiadomienia filtrowane do kategorii kierownika; (b) kierownik działu widzi wszystko, ale bez akcji spoza kategorii.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać (po D3) · **Praca**: mały

### D12. Ceny z konfiguratora dla hali i magazynu
- **Problem**: `configurator_value` jest ukryte tylko na ekranie; w danych w przeglądarce (F12) pracownik hali widzi ceny 3703 zleceń.
- **Opcje**: (a) wycinać kolumnę w bazie dla zwykłych ról (widok / uprawnienie kolumny); (b) zostawić.
- **Rekomendacja**: (a), jeśli ceny mają być tajne.
- **Pilność**: może poczekać · **Praca**: średni

### D13. Pulpit — „aktywne” = „Do wysłania” i Techniczne w „Po terminie”
- **Problem**: 1818 = 1818, w tym 797 Technicznych (prawie nigdy niewydawanych) i 177 nóg Disting Plus z wydaną nogą STA; kafel „Po terminie” 1262, z czego 720 Technicznych.
- **Opcje**: (a) „Do wysłania” = zlecenia z ukończonymi etapami, Techniczne osobnym kaflem; (b) zostawić.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D14. Spis z kartki a ruchy w trakcie
- **Problem**: magazynier liczy rano, po południu PZ +10, wieczorem przepisuje kartkę → korekta zdejmuje dostawę (system_qty z chwili wpisania).
- **Opcje**: (a) blokada PZ/MM/zdjęć na magazynie z otwartym spisem; (b) godzina liczenia na kartce i różnica od stanu z tej chwili; (c) ostrzeżenie przy ruchach.
- **Rekomendacja**: (b) + (c).
- **Pilność**: może poczekać (przed kolejnym spisem — pilne) · **Praca**: średni

### D15. Zmiana receptury na zleceniach w produkcji
- **Problem**: przeliczenie pomija zlecenia, z których coś zeszło (STA 47/92, Disting 90/282); przeliczenie startuje z przeglądarki po 15 s; zapis receptury w dwóch krokach.
- **Opcje**: (a) przeliczać tylko niezrobione etapy, w jednej funkcji bazy; (b) zostawić (receptura działa od nowych zleceń).
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: średni

### D16. MM towaru zarezerwowanego
- **Problem**: przesunięcie całego stanu zostawia rezerwacje na starym magazynie (hala dostaje „brak”, „Wydaj mimo braku” zdejmuje źródło na minus).
- **Opcje**: (a) w MM pytanie „przenieść też rezerwacje N zleceń?”; (b) blokada przesunięcia ponad wolny stan.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: średni

### D17. Klient ze sklepu zostaje „Nowy”
- **Problem**: `crm-bl-sync` przypina zamówienie do istniejącego klienta, ale nie zmienia statusu (10 klientów z opłaconym zamówieniem ma „nowy/oferta”). Porządki już ich nie zamykają (poprawka w nocy).
- **Opcje**: (a) potwierdzone zamówienie → „wygrany”; (b) dopiero wpłata.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D18. Klient wracający po przegranej
- **Problem**: oferty odrzucone przy przegranej zostają odrzucone; „Zamówił” i umowa nie mają oferty.
- **Opcje**: (a) przy „Przywróć do gry” oferty odrzucone przy przegranej → „wysłana”; (b) „Zamówił” bierze też ostatnią odrzuconą.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D19. Odstąpienie od podpisanej umowy
- **Problem**: trigger (plik 233500) blokuje każdą zmianę podpisanej umowy, także „podpisana → anulowana”.
- **Opcje**: (a) dopuścić tylko to jedno przejście z potwierdzeniem; (b) zostawić blokadę.
- **Rekomendacja**: (a), gdy będzie potrzebne.
- **Pilność**: może poczekać · **Praca**: mały

### D20. Pliki PDF przy usuwaniu klienta (RODO)
- **Problem**: bucket `crm-dokumenty` nie ma polityki DELETE — „Usuń klienta / ofertę” nie kasuje PDF-ów (8 plików po usuniętych klientach, 7 osieroconych).
- **Opcje**: (a) polityka DELETE dla osób z CRM; (b) kasowanie w funkcji serwerowej.
- **Rekomendacja**: (b).
- **Pilność**: może poczekać (RODO — raczej wcześniej) · **Praca**: mały

### D21. Follow-up po ofercie dla klienta „Zamówił”
- **Problem**: trigger `crm.po_wyslaniu_oferty` daje „Zapytaj o decyzję” także klientowi „wygrany” (komentarz migracji opisuje to jako zamierzone).
- **Opcje**: (a) pomijać wygranych; (b) zostawić.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D22. Reklamacje — poprawka w Excelu a program
- **Problem**: przy różnych wartościach etapu wygrywa program, poprawka inicjałów w Excelu nie dociera. Runda 6: w drugą stronę — „Cofnij realizację” i cofnięcie etapu w programie wracają przy następnej synchronizacji (pusty klucz = Excel uzupełnia), a data realizacji ustawia się na dzień synchronizacji (reklamacja 440).
- **Opcje**: (a) zostawić + raport różnic w Weryfikacji + zapamiętywanie cofnięć w programie (`extra_fields.cofniete`), których Excel nie uzupełnia; (b) Excel wygrywa dla wpisów, które przyszły z Excela.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: średni

### D23. Druga umowa z tej samej oferty
- **Problem**: ten sam numer tylko, gdy poprzednia jest projektem; stary projekt zostaje bez oznaczenia; protokół nadal nadpisuje plik.
- **Opcje**: (a) tak zostawić + protokół w osobnych plikach; (b) zawsze nowy numer.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D24. Numery central w podpisach maili
- **Problem**: dopięcie po telefonie z podpisu łączy maile kilku osób z firmy w jednego klienta.
- **Opcje**: (a) dopinać tylko komórki (9 cyfr od 4–8); (b) zostawić z oznaczeniem „sprawdź”.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D25. Czas realizacji ST / Bastion bez dat z Excela
- **Problem**: Excel daje sam znacznik „X” — po poprawce statystyki pomijają te daty (ST: 1 prawdziwa data).
- **Opcje**: (a) prosić halę o datę zamiast „X”; (b) zostawić z licznikiem pominiętych.
- **Rekomendacja**: (a) + (b).
- **Pilność**: może poczekać · **Praca**: mały (organizacyjny)

### D26. Archiwizacja po 12 miesiącach
- **Problem**: archiwizacja po `created_at` — w czerwcu 2027 zniknie ze statystyk import 5243 zleceń. Runda 6 (symulacja): archiwizacja zrywa też powiązania — 195 otwartych nóg par traci partnera (`ON DELETE SET NULL`), reklamacje tracą `order_id` (111 → 6), partie Bastion tracą pozycje (kaskada), WZ tracą zlecenie.
- **Opcje**: (a) archiwizować po `release_date`, parę / trójkę Titan tylko w całości (gdy wszystkie nogi zamknięte), reklamacje i partie zachowują id; statystyki z `orders ∪ orders_archive`; (b) zostawić.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać (do maja 2027) · **Praca**: średni

### D27. Pole „Kategoria” i dzień produkcji w formularzu
- **Problem**: zmiana kategorii w nowym zleceniu zapisuje je w innej zakładce z cudzym numerem; dzień produkcji tylko z kartoteki firmy.
- **Opcje**: (a) kategoria tylko do odczytu w nowym zleceniu, dzień z listą i podpowiedzią; (b) zostawić.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D28. Anulowanie Titana z zakładki Bastion
- **Problem**: anuluje tylko nogę Bastion, STA i ST zostają w produkcji.
- **Opcje**: (a) pytanie „anulować cały zestaw?”; (b) zostawić.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D29. Kolumna `orders.updated_at`
- **Problem**: bez niej nie da się ostrzec „ktoś zmienił zlecenie po otwarciu” (dziś wysyłane są tylko zmienione pola; to samo pole zmienione przez dwie osoby — wygrywa ostatni).
- **Opcje**: (a) kolumna + trigger + porównanie przed zapisem; (b) zostawić.
- **Rekomendacja**: (a) w kolejnym etapie.
- **Pilność**: może poczekać · **Praca**: średni

### D30. „Oznacz jako wydane” w Wysyłkach a rozchód od 7.11
- **Problem**: `oznacz_wydane_wysylki` zawsze anuluje rezerwacje bez rozchodu (dziś nieużywane, od ok. 7.12 obejmie zlecenia po spisie).
- **Opcje**: (a) rozchód dla zleceń od 6.11; (b) zostawić.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać (do 7.12) · **Praca**: mały

### D31. Czy magazynier planuje trasy
- **Problem**: „Dodaj do trasy” widoczne dla magazyniera, baza odrzuca zlecenia STA (drzwi wewnętrzne przechodzą). Komunikat poprawiony w nocy.
- **Opcje**: (a) chować przypinanie; (b) dopuścić magazyniera przez funkcję bazy.
- **Rekomendacja**: zależy od organizacji pracy.
- **Pilność**: może poczekać · **Praca**: mały

### D32. Szerokość „90” vs „90E”
- **Problem**: import Excela porównuje szerokość dosłownie — taki wiersz trafi do Weryfikacji jako „różni się od bota”.
- **Opcje**: (a) normalizować (bez „E”), jeśli to tylko zapis; (b) zostawić.
- **Rekomendacja**: potrzebna informacja, co znaczy „E”.
- **Pilność**: może poczekać · **Praca**: mały

### D33. Zakres ościeżnicy przy zabudowie (Bastion)
- **Problem**: formularz pokazuje pole zakresu tylko dla ościeżnicy regulowanej, a dane z Excela mają zakres także przy zabudowie (121 zleceń). Po poprawce z nocy edycja już go nie kasuje.
- **Opcje**: (a) pokazywać pole zakresu także dla zabudowy; (b) zostawić.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D34. Techniczne nigdy niewydawane
- **Problem**: 797 z 800 otwartych zleceń Technicznych nigdy nie dostaje daty wydania (zawyża Pulpit, opóźnienia, rezerwacje).
- **Opcje**: (a) wydanie z Excela dla Technicznych; (b) ręczne zamknięcie starych.
- **Rekomendacja**: ustalić, skąd ma przychodzić wydanie.
- **Pilność**: może poczekać · **Praca**: mały–średni

### D35. Weryfikacja zalana
- **Problem**: ok. 460 pozycji i ponad 1000 powiadomień tygodniowo — ważne giną.
- **Opcje**: (a) priorytety + ukrywanie starych; (b) przegląd reguł ostrzeżeń.
- **Rekomendacja**: (b), potem (a).
- **Pilność**: może poczekać · **Praca**: średni

### D36. „Ponów do Optimy” bez adresu webhooka
- **Problem**: `erp_retry_webhook_url` puste — przycisk nic nie robi.
- **Opcje**: (a) uzupełnić adres w ustawieniach; (b) schować przycisk do czasu konfiguracji.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D37. Funkcje CRM wykonywalne przez każdego zalogowanego
- **Problem**: część funkcji w schemacie `crm` ma EXECUTE tylko przez PUBLIC i bez sprawdzenia dostępu do CRM (np. `crm.zamowienie_sklepowe_wygrany` — SECURITY DEFINER). Pracownik KR bez CRM może je wywołać z F12. Anon nie może (brak dostępu do schematu).
- **Opcje**: (a) przejrzeć funkcje `crm` i dodać sprawdzenie `current_user_has_crm()` / odebrać PUBLIC; (b) zostawić.
- **Rekomendacja**: (a) — jak w pliku 233400 dla etykiet i numerów ofert.
- **Pilność**: może poczekać · **Praca**: mały–średni

### D38. Szybszy wzrost dziennika zmian po audycie stanów
- **Problem**: plik 234300 dodaje audyt na `warehouse_stock` — wpis przy każdej zmianie rezerwacji (setki dziennie). `audit_log` ma dziś 302 MB / 104 tys. wierszy, szukanie w nim jest wolne.
- **Opcje**: (a) audyt tylko przy zmianie `quantity` (nie `reserved_quantity`); (b) czyszczenie audytu starszego niż N miesięcy; (c) zostawić.
- **Rekomendacja**: (a) — rezerwacje mają własną historię w `stock_reservations`.
- **Pilność**: może poczekać (przed wgraniem 234300 warto zdecydować) · **Praca**: mały

### D40. Edycja ręcznego zlecenia drzwi wewnętrznych bez transakcji
- **Problem**: `InternalDoorOrderModal` zapisuje w 4 krokach (zlecenie → usunięcie pozycji → wstawienie → wydanie z magazynu). Zerwane łącze w środku = zlecenie bez pozycji z towarem zdjętym z magazynu; zwrot przy błędzie nie jest sprawdzany. Dziś 0 ręcznych zleceń (wszystkie z Optimy).
- **Opcje**: (a) jedna funkcja bazy zapisująca pozycje i rozliczająca stan w transakcji; (b) zostawić, dopóki nikt nie zakłada ręcznych.
- **Rekomendacja**: (a), zanim biuro zacznie zakładać ręczne zlecenia drzwi wewnętrznych.
- **Pilność**: może poczekać · **Praca**: średni

### D41. Wydanie przy błędzie zdjęcia z magazynu
- **Problem**: przy oznaczeniu etapu / wydaniu błąd RPC zdjęcia daje tylko toast „Ostrzeżenie” (a wyjątek — nic), etap i data zapisują się, rezerwacje zostają bez śladu do poprawienia (dziś 0 takich zleceń).
- **Opcje**: (a) oznaczenie zlecenia (np. `stock_status='release_failed'`) i lista w Weryfikacji; (b) blokować zapis etapu, gdy zdjęcie się nie uda.
- **Rekomendacja**: (a) — hala nie może stać przez magazyn.
- **Pilność**: może poczekać · **Praca**: mały–średni

### D43. Anulowanie wydanego zlecenia (i kaskada na wydanego partnera)
- **Problem**: menu „Anuluj zlecenie” działa na wydanym zleceniu; kaskada (Disting Plus, Titan) oznacza też wydane nogi. Excel i reklamacje pomijają anulowane, po migracji 233300 nie da się potem ponownie ustawić daty wydania. Dziś 0 takich zleceń.
- **Opcje**: (a) ukryć „Anuluj” dla wydanych, kaskada pomija wydane nogi; (b) pytanie „zlecenie jest wydane — na pewno?”.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D44. Nogi Disting po anulowaniu STA (dane)
- **Problem**: 5 otwartych nóg Disting par Disting Plus (10376, 10378, 13071, 13357, 13407) ma STA anulowane hurtowo (21.10 i 6.11) i trzyma 95 rezerwacji (265 szt., w tym 22 szt. części skrzydła e3/e4). Para 13379↔13380: Disting wydany przy anulowanym STA.
- **Opcje**: (a) anulować te nogi Disting (zwalnia rezerwacje); (b) zostawić, jeśli Disting faktycznie jest robiony bez STA.
- **Rekomendacja**: sprawdzić z halą i zdecydować per zlecenie.
- **Pilność**: może poczekać · **Praca**: mały

### D45. Ruch magazynowy, który zbija stan poniżej rezerwacji, przekroczy limit 8 s
- **Problem**: `revalidate_orders_for_component` (wołane z PZ, MM, WZR) dla każdego otwartego zlecenia z rezerwacją komponentu dopasowuje receptury (18 ms) i zapisuje pełny audyt. Przy +500 zleceń na jednym komponencie: 8,4 s → dokument się nie zapisuje („statement timeout”). Dziś max 219 zleceń (≈3,5 s). PZ: każda pozycja przelicza wszystko osobno (+2000 z brakiem: 2,3 s i 8,8 MB audytu na pozycję).
- **Opcje**: (a) przeliczać unikalne zlecenia raz na cały dokument, „część” brać z rezerwacji zamiast dopasowania receptur, braki dopisywać jednym zbiorczym UPDATE; (b) audyt pomija zmiany samych `stock_status`/`stock_issues` (przeliczenia automatu); (c) zostawić do wzrostu skali.
- **Rekomendacja**: (a) + (b) — zanim liczba otwartych zleceń się podwoi.
- **Pilność**: może poczekać (pilne przy wzroście) · **Praca**: średni

### D46. Przeliczenie rezerwacji po zapisie receptury
- **Problem**: 63 ms na zlecenie, 26 zmian `warehouse_stock` (każda = zdarzenie realtime do każdego otwartego komputera) i 13 nowych + 13 anulowanych wierszy rezerwacji na zlecenie. STA dziś ~6 s / ~2,4 tys. zdarzeń; przy +2000 zleceń ~126 s / ~53 tys. zdarzeń. `stock_reservations` ma 94% wierszy anulowanych (106 tys. z 116 tys.) po 2 miesiącach.
- **Opcje**: (a) zmiany stanów liczone zbiorczo (jeden UPDATE na komponent), zastępowane rezerwacje kasowane albo archiwizowane; (b) `warehouse_stock` poza publikacją realtime (jedno zdarzenie „przeliczono”); (c) zostawić.
- **Rekomendacja**: (a), potem (b). Decyzja: czy trzymać historię anulowanych rezerwacji.
- **Pilność**: może poczekać · **Praca**: średni–duży

### D47. Statystyki ładują całą tabelę zleceń (67 MB)
- **Problem**: `useStats.ts` pobiera `select *` całej tabeli `orders` w 24 porcjach po kolei (OFFSET → seq scan + sort w każdej porcji): 67 MB, 4,3 s samej bazy, rośnie o ~100 RO dziennie. Wykresy używają ok. 12 pól (z samymi nimi ≈7 MB).
- **Opcje**: (a) lista kolumn + stronicowanie po `id` (kursor) — mała zmiana w aplikacji; (b) agregaty w funkcjach bazy (jak `stat_wew_*`); (c) ograniczyć historię Statystyk.
- **Rekomendacja**: (a) — **zrobione w nocy** (1f41820: 15 kolumn + porcje po `id`, test `statsKolumny` pilnuje pól); docelowo (b).
- **Pilność**: może poczekać · **Praca**: mały (a), duży (b)

### D48. Wysyłka i zakładki: `select *` (3,8 kB na wiersz)
- **Problem**: przy +2000 otwartych Wysyłka ładuje 13,4 MB, zakładka STA 7,9 MB. W bazie szybko, koszt to transfer i parsowanie.
- **Opcje**: (a) lista kolumn używanych przez widok; (b) zostawić.
- **Rekomendacja**: (a) przy okazji, z testem pól.
- **Pilność**: może poczekać · **Praca**: mały–średni

### D49. Trzy indeksy wydajnościowe (gotowe, nieutworzone)
- **Problem**: trigger duplikatów przy każdym nowym zleceniu skanuje całą historię kategorii (95% czasu wstawienia); Ctrl+K = seq scan; Dziennik zmian zimny start 3 s.
- **Opcje**: (a) utworzyć (poza transakcją, `concurrently`):
  `create index concurrently idx_orders_category_created on public.orders (category, created_at desc);`
  `create index concurrently idx_audit_log_user_created on public.audit_log (created_at desc, id desc) where user_id is not null;`
  `create index concurrently idx_orders_search_trgm on public.orders using gin (order_number extensions.gin_trgm_ops, company extensions.gin_trgm_ops, client_order_number extensions.gin_trgm_ops, model extensions.gin_trgm_ops);`
  (b) zostawić.
- **Rekomendacja**: (a) — wpływ zmierzony dla pierwszego (trigger), szacowany dla dwóch pozostałych.
- **Pilność**: może poczekać · **Praca**: mały

### D50. Trzy różne znaczenia „zlecenie anulowane” w kodzie
- **Problem**: większość kodu sprawdza `extra_fields.cancelled === true`; `useExcelSync.ts` i `shipments.ts` także tekst `'true'`; `parseOrderExtraFields` (`utils.ts`) — `Boolean(cancelled)`, więc tekst `'false'` albo `1` daje „anulowane” (używane w tabeli Bastion i w zamówieniach CRM). W bazie dziś `cancelled` jest zawsze boolean (352 × true, 1 × false), więc bez skutków.
- **Opcje**: (a) jedna funkcja `isOrderCancelled` (tylko `true`) wszędzie + przeniesienie jej z modułu Optimy do neutralnego miejsca (refaktor ok. 30 miejsc); (b) zostawić.
- **Rekomendacja**: (a) — po decyzji, że dopuszczalne jest tylko `true` (tak zapisuje aplikacja i baza).
- **Pilność**: może poczekać · **Praca**: mały–średni

### D51. Drobne rozjazdy zachowania między kopiami kodu
- **Problem** (każde z osobna niewielkie, wykryte przy szukaniu duplikatów):
  - stanowisko na komputerze zgaduje licznik sztuk aluminium (`min(ilość, zrobione+1)`), telefon bierze wynik z bazy; telefon nie oznacza lokalnego zapisu etapu przed zapisem (komputer tak);
  - wykrywanie grupy Titan: trzy warunki (`!= null`, `> 0`, niepusty tekst) — różne wyniki dla `0` / `''`;
  - anulowanie drzwi wewnętrznych w oknie szczegółów najpierw zwraca towar, potem oznacza zlecenie (odwrotnie niż w zakładce zleceń — przy błędzie drugiego kroku towar wraca, a zlecenie zostaje aktywne);
  - świeży odczyt „czy anulowane”: przy braku wiersza raz blokuje zapis, raz przepuszcza;
  - `handleProblemToggle` scala `extra_fields` lokalnie zamiast wziąć wynik z bazy (gubi równoległe zmiany);
  - rola magazynier: zakładka Zamawianie jej nie pokazuje, a odhaczanie i ZD ją uwzględniają (może celowo);
  - formaty dat ZKP / magazynu: „Invalid Date” przy złych danych, `''` vs `'—'` dla pustej daty; `median` pustej listy: `null` vs `0`; kolor Aluminium w dwóch odcieniach; `ShippingView` uznaje datę ze spacji za „wydane”.
- **Opcje**: (a) ujednolicić każdą do wersji poprawnej przy okazji (po jednej, z testem); (b) zostawić.
- **Rekomendacja**: (a) — kolejność: licznik aluminium i oznaczanie etapu na telefonie, kolejność anulowania drzwi wewn., reszta kosmetyka. Rola magazynier — potwierdzić.
- **Pilność**: może poczekać · **Praca**: mały (każda)

### D52. ZKP: kto może wyłączyć ZKP na zleceniu AS 75EI
- **Problem**: `set_alu_order_zkp` wpuszcza każdego kierownika (także bez roli ZKP); wyłączenie ZKP zdejmuje kontrolę kompetencji i blokadę wydania bez teczki (symulacja: kierownik działu wyłączył ZKP i wydał zlecenie 75EI). „Nie dotyczy” w teczce wymaga już roli Pełnomocnika / Zastępcy / Kierownika Produkcji.
- **Opcje**: (a) tylko Pełnomocnik / Zastępca, z powodem; (b) dla systemu 75EI nie pozwalać wcale; (c) zostawić.
- **Rekomendacja**: (a), a dla 75EI z obowiązkowym powodem w audycie.
- **Pilność**: pilne przed pierwszym zleceniem ZKP · **Praca**: mały

### D53. ZKP: podpis etapu inicjałami innej osoby
- **Problem**: kompetencje sprawdzane są dla osoby, której inicjały podano, nie dla zalogowanej — pracownik bez kompetencji podpisał wszystkie etapy inicjałami kontrolera (na wspólnym telefonie wystarczy kliknąć cudzy kafelek).
- **Opcje**: (a) zapisywać też `auth.uid()` (kto kliknął) i dla ZKP wymagać, żeby wybrana osoba była zalogowana; (b) potwierdzenie PIN-em osoby podpisującej; (c) zostawić (zaufanie na hali).
- **Rekomendacja**: (b) dla zleceń ZKP — dokument ZKP musi wskazywać realnego wykonawcę.
- **Pilność**: pilne przed pierwszym zleceniem ZKP · **Praca**: średni

### D54. ZKP: etapy przed „Uruchom do produkcji” i pakowanie przed zwolnieniem
- **Problem**: na zleceniu ZKP można przejść wszystkie etapy (z pakowaniem) przed uruchomieniem produkcji, przed potwierdzeniem zakresu karty i bez kontroli odbiorczej.
- **Opcje**: (a) etapy dopiero po „Uruchom do produkcji”, pakowanie dopiero po zwolnieniu karty; (b) tylko pakowanie twardo blokowane, reszta ostrzeżenie.
- **Rekomendacja**: (a).
- **Pilność**: pilne przed pierwszym zleceniem ZKP · **Praca**: mały

### D55. Nowa wersja LP po rozpoczętej produkcji (ZKP i zwykłe)
- **Problem**: „Nadpisz” usuwa pozycje o zmienionym numerze razem z etapami, anuluje konstrukcję o najwyższym numerze (nawet zwolnioną, z wydaną deklaracją), a przycisk obiecuje „oznaczone etapy zostają”.
- **Opcje**: (a) przed „Nadpisz” lista pozycji / konstrukcji, które znikną (z etapami, kartami, deklaracjami) i potwierdzenie; konstrukcji z deklaracją nie anulować bez wycofania deklaracji; (b) zakaz nadpisania zlecenia ze zwolnionymi kartami.
- **Rekomendacja**: (a), a dla zwolnionych kart (b).
- **Pilność**: może poczekać (pilne przed ZKP) · **Praca**: średni

### D56. ZKP: konstrukcja NIEZGODNA blokuje zlecenie na zawsze
- **Problem**: po protokole niezgodnym karta jest zamknięta, nowego protokołu nie da się zapisać, nie ma funkcji anulowania / zastąpienia jednej konstrukcji — teczka nigdy nie będzie kompletna.
- **Opcje**: (a) funkcja „anuluj konstrukcję / nowy numer po niezgodności” dla Pełnomocnika z powodem i odnośnikiem do rejestru 6.20; (b) ponowne otwarcie karty z historią.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: średni

### D57. ZKP: zlecenia mieszane (75EI + zwykłe AS75)
- **Problem**: całe zlecenie staje się ZKP (kompetencje i teczka także dla okien, które nie są wyrobem przeciwpożarowym).
- **Opcje**: (a) ZKP na poziomie pozycji; (b) zlecenia mieszane rozdzielać przy imporcie.
- **Rekomendacja**: zależy, czy takie zlecenia się zdarzają; jeśli tak — (a).
- **Pilność**: może poczekać · **Praca**: średni–duży

### D58. ZKP: przyjęcia materiału i kwalifikacja dostawców
- **Problem**: partię niezgodną z listą 6.10.5 / uszkodzoną / niezgodną z zamówieniem można przyjąć jako PRZYJĘTO (wystarczy uzasadnienie); dostawca po terminie oceny okresowej dalej „kwalifikowany”.
- **Opcje**: (a) niezgodność wymusza kwarantannę, przeterminowana ocena = brak kwalifikacji; (b) zostawić decyzję magazynowi.
- **Rekomendacja**: (a) — decyzja Pełnomocnika.
- **Pilność**: może poczekać (przed ZKP) · **Praca**: mały

### D59. Kto edytuje szablony etykiet i dokumentów
- **Problem**: zapis do `label_templates` ma każdy kierownik (także kierownik działu, dla wszystkich kategorii). Szablon to HTML — po poprawce z nocy podgląd jest izolowany, ale druk zbiorczy i wydruk nadal renderują ten HTML (okno druku w Electronie jest odizolowane, ale treść etykiety może zostać celowo popsuta).
- **Opcje**: (a) edycja tylko dla admina / superadmina; (b) kierownik działu tylko swojej kategorii; (c) zostawić.
- **Rekomendacja**: (a) + audyt zmian (plik w toku).
- **Pilność**: może poczekać · **Praca**: mały

### D60. Zmiana nazwy wartości w słowniku a wykluczenia i reguły
- **Problem**: zmiana nazwy to zwykły UPDATE — wykluczenia (`config_exclusions`), reguły Bastion i receptury dalej wskazują starą nazwę. Dziś 90 martwych wykluczeń w STA (5 pochwytów po zmianie LINEA 170 → 160, 85 wysokości „1981 mm”…; słownik ma „1980 mm”, zlecenia z bota / Excela „2041 mm”). Zmiana nazwy ościeżnicy Bastion (np. REGULOWANA) odcięłaby flagę partii i mnożnik etykiet 117 otwartych zleceń. Brak unikalności (kategoria, typ, wartość).
- **Opcje**: (a) przy zmianie nazwy pokazać, gdzie wartość jest użyta, i przenieść ją w wykluczeniach / regułach jedną funkcją bazy; (b) blokować zmianę nazwy używanej wartości (tylko dodaj nową + wyłącz starą).
- **Rekomendacja**: (b) od razu (prosto), (a) później. Do przejrzenia z kierownikiem: 90 martwych wykluczeń i wysokości „…1 mm” vs „…0 mm”.
- **Pilność**: może poczekać · **Praca**: mały (b), średni (a)

### D61. Eksport teczki ZKP (ZIP) bez kart, protokołów i deklaracji
- **Problem**: paczka dla audytora / klienta zawiera tylko wgrane PDF-y (LP, LC, ZM); spis treści twierdzi, że karty, protokoły i deklaracje „są w teczce papierowej, dopóki program ich nie generuje” — a program ma już ich generatory PDF.
- **Opcje**: (a) dołożyć do ZIP-a PDF karty i protokołu każdej aktywnej konstrukcji oraz deklaracji (trzeba złożyć dane tak jak okna karty — kilka zapytań na konstrukcję); (b) zostawić papier.
- **Rekomendacja**: (a) przed pierwszym audytem ZKP. Bez decyzji biznesowej — tylko praca.
- **Pilność**: może poczekać · **Praca**: średni

### D62. Telefon: kategorie pracownika i odhaczanie drzwi wewnętrznych przez kierownika działu
- **Problem**: zakładka Zlecenia na telefonie pokazuje wszystkie 7 kategorii (komputer pokazuje tylko kategorie pracownika). Kierownik działu z kategorią tylko STA może odhaczać pozycje drzwi wewnętrznych (`current_user_can_pick()` nie sprawdza kategorii; sprawdzone w cofniętej transakcji).
- **Opcje**: (a) telefon pokazuje tylko kategorie użytkownika, odhaczanie drzwi wewn. tylko kierownik / magazynier / kierownik działu z kategorią DrzwiWewnetrzne; (b) zostawić — hala pomaga sobie nawzajem.
- **Rekomendacja**: (a).
- **Pilność**: może poczekać · **Praca**: mały

### D63. Wspólny telefon na hali — kto jest „zalogowany”
- **Problem**: komputer wylogowuje po 60 min bezczynności, telefon nigdy. Na wspólnym telefonie zdjęcia, odhaczenia drzwi wewn. i domyślne inicjały etapu idą na ostatnią zalogowaną osobę (por. D53 dla ZKP).
- **Opcje**: (a) wylogowanie telefonu po bezczynności (np. 30 min); (b) wybór osoby (kafelek) przy zdjęciu i odhaczeniu; (c) zostawić — każdy ma własny telefon.
- **Rekomendacja**: zależy, czy telefony są wspólne; jeśli tak — (b), bo nie wyrzuca z pracy w trakcie zmiany.
- **Pilność**: może poczekać · **Praca**: mały (a), średni (b)

### D64. Etap cofnięty w programie wraca z Excela (zlecenia — rozszerzenie D22)
- **Problem**: po cofnięciu etapu (towar wraca ZWR) synchronizacja Excela widzi pusty etap i inicjały w arkuszu, wpisuje etap ponownie i znowu zdejmuje materiał. Dopóki komórka w Excelu jest wypełniona, cofnięcia nie da się utrzymać (sprawdzone: zlecenie STA 17634, etap e1). D22 opisuje to samo dla reklamacji.
- **Opcje**: (a) zapamiętywać cofnięcia (`extra_fields.cofniete_etapy`) i nie uzupełniać ich z Excela, aż komórka w Excelu się zmieni; (b) cofnięcie w programie czyści też komórkę w Excelu (wymaga zapisu do arkusza); (c) zasada: cofamy tylko w Excelu.
- **Rekomendacja**: (a), razem z D22 — jedna reguła dla zleceń i reklamacji.
- **Pilność**: może poczekać (do czasu, aż etapy przestaną iść z Excela) · **Praca**: mały–średni

### D65. Szkice ZD nie liczą się jako „w drodze”
- **Problem**: Alerty liczą „w drodze” tylko z ZD wysłanych / częściowych. Osoba A generuje ZD (szkic), osoba B dalej widzi alert z „W drodze = 0” i zamawia drugi raz ten sam towar. Lista zakupów jest tylko w pamięci jednego komputera.
- **Opcje**: (a) osobna kolumna „w szkicu” w Alertach i ostrzeżenie przy dodawaniu do listy; (b) liczyć szkice jako „w drodze”.
- **Rekomendacja**: (a) — szkic to jeszcze nie zamówienie. Łączy się z D9 (jedna reguła „ile zamówić”).
- **Pilność**: może poczekać · **Praca**: mały

### D66. Limit czasu zapisów (wieczne „Zapisywanie…”)
- **Problem**: zapisy do bazy nie mają limitu czasu — przy zerwanym WiFi napis „Zapisywanie…” / „Wysyłanie…” wisi, aż system sam zerwie połączenie (na telefonie bywa to kilka minut), a przyciski są zablokowane.
- **Opcje**: (a) globalny limit w kliencie Supabase (np. 30 s dla bazy, 2 min dla plików) z komunikatem „mógł się zapisać — odśwież”; (b) limit tylko na telefonie; (c) zostawić.
- **Rekomendacja**: (b) od razu (mniejsze ryzyko), (a) po obserwacji — długie operacje (importy, generowanie PDF) trzeba wyłączyć z limitu. Zmiana dotyczy całego programu, dlatego nie robiłem jej w nocy.
- **Pilność**: może poczekać · **Praca**: mały

### D67. Zdjęcia z telefonu: rozmiar, HEIC, osierocone pliki
- **Problem**: telefon wysyła oryginał bez zmniejszania; bucket `order-photos` ma limit 10 MB i przyjmuje tylko jpeg / png / webp / gif — duże zdjęcie albo HEIC (iPhone) daje „zrób jeszcze raz”, a ponowienie nie pomoże. Gdy wpis w bazie się nie uda, pracownik nie może skasować pliku (kasuje tylko kierownik) — zostaje sierota. Dziś 0 zdjęć w bazie.
- **Opcje**: (a) zmniejszanie przed wysłaniem (np. 1600 px, JPEG) — rozwiązuje rozmiar i HEIC; (b) podnieść limit bucketu i dopuścić HEIC; (c) sprzątanie sierot raz na dobę po stronie serwera.
- **Rekomendacja**: (a) + (c).
- **Pilność**: może poczekać (przed wdrożeniem zdjęć na hali) · **Praca**: mały–średni

---

## Refaktory do rozważenia
(uzupełniane w nocy — tylko opisy, bez wdrażania; zysk w liniach szacunkowy)

| # | Co | Gdzie | Zysk | Ryzyko | Uwagi |
|---|---|---|---|---|---|
| R1 | Martwe eksporty i stary kod (ok. 20 pozycji) | `utils.ts` (m.in. `isOrderOverdue`, `getOrderTargetProductionDate`, `formatTodayDDMMYYYY`), `orderTableColumns.tsx` `rushCol` („od beta.90 nieużywana”), `constants.ts`, `useCrm.ts` `markZadanieZrobione` i inne | ~170 l. | niskie | robione w nocy po kolei, gdy brak otwartych błędów wysokich |
| R2 | Nieużywane parametry hooków (`setOrders` w useShipping, `pushToast` w useStats, `archivedOrders`/`setDeleteConfirm` w useComplaints) | hooki + `App.tsx` | ~10 l. | niskie | jw. |
| R3 | Rozwlekłe warunki (`x && !isReleaseDateEmpty(x)` → `!isReleaseDateEmpty(x)`, `isOrderCancelled` zamiast ręcznych wstawek) | ~15 miejsc | ~15 l. | niskie | jw. |
| R4 | Wspólne formatery dat / kwot / ilości (dziś 3–9 kopii każdego) | komponenty magazynu, ZKP, CRM | ~110 l. | niskie | tylko identyczne kopie; różniące się → D51 |
| R5 | Inicjalizacja pdfmake (6 kopii), wybór drukarki (4 kopie), IPC aktualizacji (2 kopie), stałe mobilne (`CAT_COLORS` ×4, `flash()` ×3) | utils PDF, modale druku, widoki mobilne | ~155 l. | niskie–średnie | |
| R6 | `merge_order_extra_fields` + aktualizacja stanu (helper), `patchOrder(id, patch)`, ręczne pętle stronicowania → `fetchAllPages`, porcje po id → wspólny `chunk()` | `useShipping`, `useOrders`, kilka hooków | ~185 l. | średnie | pętle stronicowania różnią się obsługą błędu (część to poprawka — patrz D51) |
| R7 | `MmView` / `PzView` (80% wspólne), 5 widoków tabel w `App.tsx` z tym samym zestawem ~20 propsów | widoki magazynu, `App.tsx` | ~175 l. | średnie | |
| R8 | Końcówka zapisu edycji w `useOrders` (blok bota ×5, łatka zlecenia ×3), anulowanie / przywracanie | `useOrders.ts` | ~90 l. | średnie–wysokie | logika krytyczna — najpierw testy |
| R9 | Oznaczanie etapu: komputer i telefon osobno (zlecenia, reklamacje, sztuki alu ×3) | `useMyStation`, `MobileStationView`, `useAluOrders` | ~70 l. | wysokie | najpierw ujednolicić zachowanie (D51) |
| R10 | Kanały „na żywo” bez przeładowania po przerwie (8 miejsc: wysyłka, dzwonek, magazyn, Bastion, odhaczanie) | `useShipping`, `NotificationBell`, `useWarehouse`, `useBastion*`, `useOrderPicks`, `MobileIntDoorPicking` | ~60 l. | średnie | wspólna funkcja „subskrybuj i przeładuj po ponownym połączeniu” (wzór: `App.tsx`, `MobileStationView`); runda 10 #5 |
