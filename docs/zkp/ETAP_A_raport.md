# ZKP ALURON AS 75EI — Etap A: rozpoznanie

> Raport z rozpoznania wg briefu `BRIEF_ZKP_AS75EI.md`, pkt 3. **Bez kodu.**
> Stan repo: `clean` @ v1.0.0-beta.67 (2026-10-26). Baza: projekt `vwlabgmilckfhtuerzio`.
> Dalsze etapy dopiero po akceptacji właściciela i odpowiedziach z pkt 9.

## 0. Najważniejsze w pięciu punktach

1. **Moduł aluminium ma zlecenia i pozycje, ale nie ma sztuk.** Sztuka to dziś licznik kliknięć w pozycji, a numer „2/5" powstaje tylko na wydruku etykiety. Numer konstrukcji `RRRR/ZZ/PP` (ZKP 5.9) wymaga nowej tabeli: jeden wiersz na sztukę.
2. **Nie ma pojęcia partii materiału** — ani w bazie, ani w kodzie. Nie ma też kwarantanny, dokumentu jakości przy PZ ani kwalifikacji dostawców. Do tego **aluminium w ogóle nie korzysta z magazynu**: nie ma receptur, rezerwacji ani wydań na zlecenie aluminiowe. Identyfikowalność (B4) trzeba zbudować od zera.
3. **Konflikt z briefem — konta.** Brief zakłada, że każdy pracownik ma własne konto. Kod robi odwrotnie: stanowiska **współdzielą konta**, a pracownik wybiera swój kafelek bez hasła. Do bazy idą wtedy tylko jego inicjały jako tekst, bez identyfikatora użytkownika i bez czasu serwera. W bazie jest dziś 10 kont. Bez osobistego logowania podpisy ZKP (pkt 10 briefu) nie przejdą.
4. **Teczka dokumentów nie spełnia ZKP 5.1.6 / 6.34.** Import nowej LP/LC/ZM **kasuje** poprzedni plik (`UNIQUE(order_id, kind)` + usunięcie ze Storage). Kierownik może usuwać wpisy i pliki. Dziennik audytu jest **czyszczony po 12 miesiącach**, a ZKP wymaga 10 lat.
5. **Fundament jest dobry.** Trigger audytu zapisuje `auth.uid()` i czas serwera, `audit_log` jest zablokowany przed edycją, RLS z rolami działa. Wydruki A4 do PDF też już działają (`print:exportPdf`). Jest prywatny bucket `order-documents`, a parser LP **już czyta** tabele materiałowe (kod profilu, długość, kąty), tylko ich nie zapisuje.

## 1. Moduł stolarki aluminiowej

| Element | Stan |
|---|---|
| Zlecenie | `orders` z `category='Aluminium'`, `source='alu_lp'`, nagłówek w `extra_fields.alu` (`migrate/aluminium_etap1.sql:391`) |
| Pozycje | `order_alu_positions`: `pos_no`, `system`, `construction_type` (drzwi/okno/scianka/inne), wymiary, `quantity`, masa, U, `glass` jsonb, `production_stages` jsonb; `UNIQUE(order_id,pos_no)` |
| Sztuki | **brak tabeli**; `production_stages = {etap:{done, marks[]}}`, gdzie jedno kliknięcie to jedna sztuka (`aluminium_etap2_etapy.sql:3`). `marks[]` = inicjały, bez czasu i bez numeru sztuki |
| Etapy | cięcie → okuwanie → składanie → szklenie → pakowanie (`constants.ts:654`) |
| Parser LP | numer LP, numer zlecenia OF, klient, termin, pozycje (system bez prefiksu „ALURON", kolory, wypełnienia, wymiar zewn., ilość, masa, U, szkło, okucia/klamka/próg/dodatki). Tabele materiałowe są czytane (`MaterialRow`: kod profilu, ilość, długość, kąty), ale **nie są zapisywane**; kolumna „Położenie" jest pomijana (`aluLpParser.ts:614`). Pole LP „Ilość konstrukcji" jest ignorowane |
| Parser LC | tylko nagłówek (`lc_number`, OF, klient). PDF zawiera elementy (np. `K1106 …`, długości `735,5 / 856,0`, oznaczenia `A.A.Klamka`, `A.A.Zawias`, sztabę `/1/`, kod `OF341200001`), ale **nic z tego nie trafia do bazy** |
| Parser ZM GLASS | numer, dostawca, numery zleceń (`OF270/2026:1:4`), szyby |
| Oryginały | bucket `order-documents` (prywatny, PDF, 20 MB), ścieżka `aluminium/<orderId>/<kind>_<timestamp>.pdf`, wpis w `order_documents`. Nowy plik tego samego rodzaju **zastępuje i fizycznie usuwa** stary (`useAluOrders.ts:274`) |
| Rozpoznanie systemu | `system` to wolny tekst: „ALURON AS75" zamienia się w „AS75". W fixture'ach są AS75 i AS52. **Brak próbki AS 75EI** — nie wiadomo, jak LP go podpisuje |
| Firma | moduł nie ma pola wykonawcy/producenta; MR Profil występuje tylko jako odbiorca w ZM GLASS |

Testowe zlecenie w bazie: `OF341/2026` (FINEZJA Strzegom), 1 pozycja, system `AS75`, drzwi 1090×2060.

## 2. Zlecenia

- **Numeracja aluminium:** numer OF z pliku LP (`OF341/2026`), nie generowany przez program; przy duplikacie dostaje dopisek ` (2)`. Pozostałe kategorie: MAX+1 w kategorii. **Nie ma licznika w roku.**
- **Statusy:** wyliczane („Anulowane" z `extra_fields.cancelled`, „Wydane" z `release_date`, w przeciwnym razie „W realizacji"). Nie ma statusu „uruchomione do produkcji" — import od razu tworzy aktywne zlecenie.
- **Zamówienie klienta:** brak powiązania (`client_order_number=''`).
- **Anulowanie:** `cancelled_at` i `cancelled_by` przysyła klient (czas komputera i inicjały), nie serwer.

## 3. Magazyn

- **PZ** (`create_pz_document`, `receive_purchase_order`): pozycja zawiera tylko komponent, ilość i uwagi. Dostawca i numer WZ/faktury nie są zapisywane (numer dostawy trafia co najwyżej do tekstu `reference_doc`). **Brak załączników** (skanów dokumentów jakości).
- **Wydania (WZ)** dotyczą tylko zleceń z recepturami (STA/Disting/ST/Bastion): `release_stock_for_stage` przy oznaczeniu etapu. Ruch ma `order_id`, a etap jest zapisany tylko w tekście `reference_doc`. **Aluminium nie jest podpięte pod magazyn.**
- **Partie:** **brak** (jedyne „partie" w programie to partie produkcyjne ościeżnic Bastiona — co innego).
- **Kwarantanna / blokada stanu:** brak; stan może zejść na minus (wydanie wymuszone).
- **Dostawcy:** nazwa, kontakt, czas dostawy, `is_active`. **Brak kwalifikacji i ocen.** Zamówienia do dostawców (ZD) nie sprawdzają nawet `is_active`.

## 4. Użytkownicy, role, RLS

- **Logowanie:** login zamieniany na `login@krcenter.pl`; w bazie 10 kont (3 admin, 2 kierownik_dzialu, 5 pracownik_produkcji).
- **Stanowiska: konta współdzielone** (`useAuth.ts:148`). Wykonawcę etapu wybiera się z kafelków `worker_stages` bez hasła, a do bazy idą inicjały (`useMyStation.ts:206`).
- **Role:** obsluga_klienta, pracownik_produkcji, magazynier, kierownik_dzialu, kierownik_magazynu, kierownik_produkcji, admin (+ legacy). **Nie ma ról jakościowych** (PJ, Zastępca, kontroler) ani pojęcia „zatwierdzenia/podpisu".
- **RLS:** pomocnicze `current_user_is_manager()` / `_admin()`, trigger przeciw podniesieniu własnej roli. `orders` i pozycje aluminium: odczyt dla wszystkich zalogowanych, zapis dla kierowników. Część starszych polityk istnieje tylko w bazie, nie ma ich w repo.
- **Audyt:** `audit_trigger_fn` zapisuje `auth.uid()`, e-mail i `now()`, a `audit_log` ma politykę „no modify". Obejmuje orders, ruchy, stany, rezerwacje, receptury, komponenty, profile i konfigurację — **nie obejmuje** `order_alu_positions`, `order_documents`, dostawców ani ZD. **Retencja: cron kasuje wpisy starsze niż 12 miesięcy** (`migrate/retencje_logow.sql`).
- **Twarde usuwanie** występuje w kodzie m.in. dla rezerw zleceń, receptur, komentarzy, zdjęć, `print_documents` i kont użytkowników (FK `ON DELETE SET NULL` gubi autora).

## 5. Pliki (Storage)

| Bucket | Zawartość | Usuwanie |
|---|---|---|
| `order-documents` | prywatny; LP/LC/ZM aluminium | kierownik (polityka storage + kasowanie przy zamianie) |
| `order-photos` | publiczny; zdjęcia pakowania | kierownik |

Deklaracje DoP/DWU **nie są w Storage**: leżą jako statyczne pliki base64 w `print_documents` i nie mają danych zlecenia. Nie ma śladu, która deklaracja została wydrukowana dla którego zlecenia.

## 6. Wydruki

- **pdfmake:** ZD do dostawcy, zamówienie szkła, inwentaryzacja (z `.download()`).
- **Etykiety HTML** z polami `{{…}}` i QR (`labelRender.ts`). Szablony w `label_templates` (m.in. „Aluminium — sztuka" 100×150 z polami `alu_*`). QR zawiera tylko id zlecenia.
- **Electron:** `print:exportPdf` (printToPDF + zapis), `label:printHtml`, `label:printRaw` (ZPL na Zebrę).
- **Etykiet elementów cięcia nie ma.**
- **Rekomendacja dla formularzy z załączników:** szablon HTML/CSS A4 z `@page` wysłany przez `print:exportPdf` (wzorzec etykiet). pdfmake zostawić do tabelarycznych rejestrów (6.33, 6.24, 6.20).

## 7. Mapa luk (brief pkt 4–10)

Legenda: ✅ jest · 🟡 częściowo · ❌ brak

| Wymaganie (ZKP / zał.) | Stan | Proponowane rozwiązanie |
|---|---|---|
| **B1** numer `RRRR/ZZ/PP` na sztukę, nadawany przy uruchomieniu, niezmienny, unikalny (5.9) | ❌ sztuk nie ma; brak licznika w roku; brak kroku „uruchom" | tabela `alu_constructions` (wiersz na sztukę: `year`,`zz`,`pp` int + `UNIQUE`, `position_id`, `piece_index`, status z „anulowana" bez kasowania); licznik `ZZ` w tabeli z blokadą wiersza w RPC `start_alu_production(order_id)`; tekst numeru budowany z liczb. Ze sztuką zwiążą się później oznaczenia etapów |
| **B2** numer na elementach w toku (5.9) | ❌ LC niezapisywana, brak etykiet elementów | rozszerzyć parser LC o elementy (kod, długość, oznaczenie, sztaba, kod kreskowy) → tabela `alu_cut_elements`; etykieta „element" z numerem konstrukcji. **Do potwierdzenia na próbce:** czy oznaczenia LC (`A.A.Klamka`) wskazują pozycję/sztukę |
| **B3** teczka zlecenia: kompletność, oryginały bez nadpisywania, bez usuwania, eksport (5.9, 5.1.6) | 🟡 bucket + `order_documents`, ale zamiana kasuje plik i kierownik może usuwać | `order_documents`: wersje zamiast `UNIQUE(order,kind)`, `withdrawn_at/by/reason` zamiast kasowania, odebrać DELETE w RLS i Storage dla teczek ZKP, nowe rodzaje dokumentów (zamówienie klienta, PZ, RW, karta, protokół, deklaracja, montaż), lista wymaganych z „jest/brak/nie dotyczy", blokada zamknięcia przy brakach, eksport ZIP/PDF ze spisem treści |
| **B4** partie komponentów krytycznych: przyjęcie → wydanie → karta; ścieżka partia → konstrukcje (5.9, 5.8) | ❌ brak partii; aluminium poza magazynem | najpierw **Etap F** (partie przy PZ), potem wydanie RW na zlecenie aluminium z partią, wybór partii na karcie (cz. C/E) per konstrukcja i miejsce, widok odwrotny partia → konstrukcje (wydane / w produkcji) |
| **B5** wyszukiwarka „od tabliczki", rejestr wyrobów 6.33 + eksport PDF/XLSX | ❌ | widok z danych (bez osobnej tabeli), eksport pdfmake / XLSX |
| **C** pola pozycji wg 6.30, kontrola kompletności, sprawdzenie zakresu z `as75ei_zakresy.json`, potwierdzenie zakresu (5.5.1) | 🟡 LP daje część pól (system, wymiary, masa, okucia, próg, kolor, szkło); reszty brak | tabela `zkp_alu_item` (pola 6.30) + słownik `zkp_zakresy` (edycja tylko PJ) wczytany z JSON; RPC sprawdzające → OK / poza zakresem / nie sprawdzono; zatwierdzenie zakresu przez PJ/KP. **Pliku JSON nie mam** |
| **C** karta wyrobu 6.25 cz. A–F, wyniki IS-01..06, NOK wg 5.8 | ❌ etapy to tylko inicjały bez czasu | zapisy kontroli per konstrukcja (wynik, data serwera, operator = `auth.uid()`, partie), historia wersji przy NOK, statusy „niezgodny / zablokowany", etykieta „WYRÓB NIEZGODNY" |
| **D** protokół 6.17.5, przyrządy, uprawnienia, zwolnienie (5.7, 5.3.2) | ❌ | protokół = numer konstrukcji; pomiary z kryterium automatycznym; przyrządy tylko z rejestru (Etap H); zwolnienie tylko PJ/Zastępca |
| **E** KDWU/DWU z danych konstrukcji, numeracja w roku, tabliczka 6.26, etykieta B/CE (5.11) | 🟡 jest druk statycznych DoP/DWU i etykiety HTML | generator deklaracji z wzorów 6.9 (HTML A4), liczniki `KDWU/RR/NNNN` i `DWU/RR/NNNN`, blokada przy pustym nr certyfikatu, podpisany PDF wraca do teczki |
| **F** rejestr przyjęć 6.24, kwarantanna, dostawcy kwalifikowani 6.31 (5.4) | ❌ | `material_lots` (komponent, partia, dostawca, WZ/FV, dokument jakości + skan, decyzja, kto); flaga „krytyczny" na komponencie + powiązanie z listą 6.10.5; partia bez numeru lub dokumentu = kwarantanna, której nie da się wydać; kwalifikacja i oceny w `suppliers` |
| **G** niezgodności i działania korygujące 6.19/6.20 | 🟡 są reklamacje (complaints) i zniszczenia — bez pól z załącznika | osobny rejestr ZKP powiązany z konstrukcją / zleceniem / partią / dostawcą |
| **H** przyrządy 6.13–6.15, 6.14.1 | ❌ | rejestr + zdarzenia + alert terminu + wydruk roczny |
| **pkt 10.1** kto i kiedy, konto osobiste | 🟡 trigger audytu tak; stanowiska — konta wspólne + inicjały | **decyzja właściciela (pyt. 7)**; wszystkie zapisy ZKP przez RPC z `auth.uid()` i `now()` |
| **pkt 10.2–10.3** podpis = zatwierdzenie, blokada po zatwierdzeniu, korekta jako wersja z powodem | ❌ | wspólny wzorzec dla wszystkich zapisów ZKP: `approved_by/at` z serwera, trigger blokujący UPDATE po zatwierdzeniu, korekta = nowy wiersz z `supersedes_id` i powodem |
| **pkt 10.4** bez twardego usuwania, 10 lat | ❌ retencja audytu 12 mies., DELETE dostępny | wyłączyć tabele ZKP z crona retencji (albo osobny dziennik ZKP), brak polityk DELETE, Storage bez usuwania |
| **pkt 10.5** RLS, nie tylko UI | 🟡 wzorzec jest | role ZKP jako uprawnienia na koncie (np. `profiles.zkp_roles text[]`: pelnomocnik, zastepca, kontroler, kierownik_produkcji, magazyn) + funkcje pomocnicze w RLS |
| **pkt 10.6** kopia ≥ 1×/mies. | 🟡 Supabase Pro (7 dni) + lokalne pg_dump (tylko schemat `public`, **bez plików Storage**, na tym komputerze) | comiesięczny pełny pg_dump + eksport obiektów Storage poza Supabase (pyt. 5) |
| **pkt 10.7** wydruki w układzie załączników | 🟡 mechanizm jest | szablony HTML A4 per załącznik — **potrzebuję wzorów załączników** |
| **Producent = MR Profil** (pkt 1.5) | ❌ moduł nie zna producenta | dane MR Profil jako konfiguracja ZKP; każdy zapis ZKP przypisany do MR Profil |

## 8. Proponowana kolejność (zmiana względem A→H)

0. **Fundament (przed B):** role ZKP, wzorzec zatwierdzeń i blokady, wyłączenie z retencji, decyzja o kontach. Bez tego każdy kolejny etap trzeba by przerabiać.
1. **B1 + B3:** sztuki z numerem konstrukcji, krok „uruchom do produkcji", teczka z wersjami i bez usuwania.
2. **B2:** parser LC → elementy → etykiety elementów (po otrzymaniu próbki AS 75EI).
3. **F przed B4:** partie przy przyjęciu, kwarantanna, dostawcy. Bez partii nie ma czego wiązać w B4.
4. **B4 + C razem:** wybór partii odbywa się na karcie wyrobu (cz. C/E), więc rozdzielanie ich oznacza podwójną robotę.
5. **B5**, potem **D → E → G → H**.

## 9. Pytania do właściciela

**Z briefu (pkt 11):**
1. **Skąd `ZZ`?** Dziś numer zlecenia to OF z pliku (`OF341/2026`) — liczy wszystkie oferty/zlecenia (też AS52, AS75 bez EI), więc nie jest „kolejnym zleceniem AS 75EI w roku". Propozycja: **osobny licznik zleceń z pozycjami AS 75EI**, nadawany przy uruchomieniu. Alternatywa: licznik wszystkich zleceń aluminium.
2. **Jak rozpoznać AS 75EI w LP?** Zwykły AS75 przychodzi jako „ALURON AS75" → „AS75". Potrzebuję **prawdziwych LP, LC i ZM zlecenia AS 75EI** (nie ma ich w repo).
3. **Zestawienie materiałowe i zamówienia profili/okuć:** z tabel materiałowych LP (parser je czyta, można zapisać) czy z modułu ZD?
4. **Kto pełni role:** PJ, Zastępca PJ, Kierownik Produkcji, kontrolerzy odbiorczy, brygadziści, magazyn?
5. **Gdzie comiesięczna kopia** (bazy + plików)? Dropbox MR Profil?
6. **Czy montaż wykonuje Producent** (protokół 6.28 w teczce)?

**Nowe, wynikające z rozpoznania:**
7. **Konta na hali.** Brief mówi „każdy ma własne konto", a kod działa na kontach wspólnych z kafelkami bez hasła. Dla zapisów ZKP potrzebny jest osobisty login (albo PIN przypięty do konta), bo inaczej podpis = inicjały bez dowodu. Jak to rozwiązać: (a) każdy loguje się sam, (b) wspólne stanowisko, ale akcje ZKP wymagają PIN-u/hasła pracownika?
8. **Retencja:** zgoda na wyłączenie zapisów ZKP i ich audytu z 12-miesięcznego czyszczenia (10 lat, zał. 6.34)?
9. **Magazyn dla aluminium:** czy komponenty krytyczne AS 75EI (wkłady, uszczelki pęczniejące, szkło ogniochronne, okucia) będą przyjmowane i wydawane w programie? Na który magazyn (Marklowicka)?
10. **Czyszczenie bazy przed startem** (planowane): zapisy ZKP muszą przetrwać — ustalmy, że czyszczenie nie dotyka tabel ZKP albo ZKP startuje po czyszczeniu.
11. **Elementy LC:** czy oznaczenia w Liście cięć (`A.A.Klamka`, `A.A.A.1`) wskazują pozycję/sztukę? Na jakiej drukarce i w jakim formacie drukować etykiety elementów (Zebra ZPL, wymiar)?
12. **Brakujące materiały:** proszę o `as75ei_zakresy.json` (nie ma go obok briefu) i o załączniki 6.17.5, 6.24, 6.25, 6.26, 6.30, 6.33 (ścieżka z briefu jest na innym komputerze).
