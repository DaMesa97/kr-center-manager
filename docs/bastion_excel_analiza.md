# Bastion w Excelu vs aplikacja — analiza (31.10.2026)

Źródło: `Zamówienia Bastion kopia.xlsm` (7,7 MB, 31 arkuszy, VBA ~2000 linii + biblioteka JSON).
Cel: co z obiegu Bastiona aplikacja już robi, czego brakuje, co w Excelu jest martwe.

## 1. Jak Excel prowadzi zamówienia Bastion

**Arkusze robocze (widoczne):**

| Arkusz | Rola | Wierszy 2024 / 2025 / 2026 |
|---|---|---|
| Zamowienia Center | drzwi KR Center (BASIC, BASIC PLUS, BASIC LOCK PLUS, PREMIUM, PREMIUM RC2) | 6358 / 9286 / 7251 |
| Zamowienia Profil | to samo dla MR Profil | 354 / 554 / 443 |
| Zamowienia Bold Center / Bold Profil | system BOLD / BOLD PLUS (osobna numeracja) | 563+659 / 921+977 / 973+530 |
| Zamowienia Center INTERIOR / Profil INTERIOR | system SILENT (drzwi wewnętrzne), kolumna ZAMEK zamiast WIZJER, PRÓG/WENTYLACJA | 0 / 0 / 73+64 (od 2026) |
| Reklamacje | reklamacje z własną numeracją, kopiują dane zlecenia | 143 / 168 / 152 |
| Reszta | „drobnica": progi BOLD, opaski, zabudowy kątowe — bez modelu, z odniesieniem do numeru zlecenia (`NR KR CENTER`) | 238 / 412 / 362 |
| OŚC.REG. NOWE / KOKS | **partie ościeżnic regulowanych**: partia → zakres numerów zleceń → etapy per partia (panele: cięcie, frezarki, CNC, lakiernia, oklejarki; opaski: cięcie, CNC; skręcanie kpl) z inicjałami i datami | ~200 partii |
| Dodawanie zamowienia | formularz (dwie kolumny KR / MR + panel reklamacji), przyciski VBA | — |
| Dane formularza | słowniki: 135 modeli, 46 kolorów, 19 szerokości, 13 okuć, 8 systemów, 17 progów, 11 wizjerów/zamków, 14 typów ościeżnic z mnożnikiem etykiet | — |
| Kontrahenci | 3067 firm: miasto, dzień trasy → dzień produkcji (SWITCH: trasa PN→prod CZW, WT→PT, ŚR→PN, CZW→WT, PT→ŚR) | — |

**Arkusze ukryte = martwe (dane kończą się w 2023):** Receptury, Statystyki, II gatunki, Produkcja, Przyjęcie/Wydanie towaru, NP-historia, Oscieznice-STAN, Skrzydla-STAN, Produkcja-STAN, Szyby-modele. To stary magazyn gotowych ościeżnic/skrzydeł z 2023 — porzucony. Nie przenosimy.

**Kolumny tabeli zleceń (44):** numer, kolekcja, model, szerokość, kierunek+otwieranie, kolor skrzydła (całk./WF), system, ilość, data, firma, **6 etapów** (CNC, okleinowanie skrzydła, okuwanie skrzydła, ościeżnica CNC, ościeżnica skręcanie i okuwanie, magazyn/kontrola odbiorcza), zmiany-sprzedaż, pilne/termin, dzień tygodnia, kolejność, okucia, próg, ościeżnica, zakres, kolor ościeżnicy, wysokość, wizjer, uwagi, magazyn regulowane, regulowana do złożenia, stolarnia, naklejka, uwagi 2, zrealizowane, promo, kolejność produkcji ościeżnic reg., numer zamówienia klienta, wartość konfigurator, wpisał, ilość etykiet (formuła: ilość × mnożnik typu ościeżnicy, LACOBEL +1), Airtable ID.

**Etapy** to inicjały pracownika (P, E, Z, S, G, J, W, T, K, L, A, M…) albo wartości specjalne: `X` (nie dotyczy), `2P`/`P/Z` (dwie sztuki), `NIE FREZOWAĆ`, `WSTRZYMANE`, `BRAK OŚC`, `NA STOJAKU`. Formatowanie warunkowe podświetla: typ ościeżnicy stalowej/metalowej, ilość ≥ 2, „Z BOLCAMI" w uwagach, a w Reszcie i Reklamacjach wiek zlecenia (7 i 14 dni bez realizacji).

**Logika VBA przy dodawaniu (dodajZamowienieDoArkusza):**
1. Numer = największy w danym arkuszu + 1 (osobne liczniki: Center, Profil, Bold Center, Bold Profil, Center INTERIOR, Profil INTERIOR, Reklamacje, Reszta).
2. Kolekcja z prefiksu modelu: `A-` ALU, `N-` NOWOCZESNE, `T-` TRADYCYJNE, `ST` STANDARD, `LA/L-` LACOBEL, `LU` LUX (+ ALU BLACK/PATINA/RADIUS).
3. **Reguły domyślne:** ościeżnica STAL* przy BOLD → system BASIC; STAL albo BOLD: szerokość 80 → 845, 90 → 945; wizjer pusty → „BEZ WIZJERA"; wysokość pusta → tabela domyślnych po systemie × ościeżnicy × szerokości (BASIC + drewniana pełna 80/90 → „208 Z OŚC", NW → „205 Z OŚC", PREMIUM → 207.3 / 204.3, regulowana/opaskowa → 206 / 203 i 205.3 / 202.3, metal → 203.5 / 200.5, STAL i BOLD → „201.5 wf"); dwukolor → „CAŁK/WF"; STAL bez uwag → „Z BOLCAMI"; BOLD bez uwag → „BEZ BOLCÓW"; BASIC LOCK PLUS / PREMIUM RC2 → okucia + „ 92" i uwagi „ZAMEK LISTWOWY MACO"; PREMIUM* → próg + „ NISKI"; poszerzenia boczne z JSON konfiguratora → do uwag; SILENT → otwieranie ND, wizjer BRAK.
4. Ręcznie pyta o „wartość netto z konfiguratora" i „MODEL PROMO?", o imię wpisującego.
5. Po zapisie: webhook do Make (nowe zamówienie) i dla „NOWY BOT" numer zlecenia wraca do Airtable (recordId).
6. Reklamacja: kopiuje wiersz zlecenia po numerze do arkusza Reklamacje z powodem i „co reklamowane" (komplet/skrzydło/ościeżnica).

## 2. Co aplikacja już ma dla Bastiona

| Obszar | Stan w aplikacji |
|---|---|
| Kategoria Bastion, formularz, tabela | ✅ pełny formularz (`BastionOrderFormData`: kolekcja, typ ościeżnicy, zakres, panele boczne/górny, promo, pilne, priorytet ościeżnic reg., ilość etykiet), tabela z tymi samymi kolumnami co Excel |
| 6 etapów produkcji + stolarnia + magazyn regulowane + regulowana do złożenia | ✅ `BASTION_STAGE_DEFS` (9 etapów), inicjały, mobilne stanowisko, Titan (tit_oku/mon/pak) |
| Firma → dzień trasy → dzień produkcji | ✅ kontrahenci z `route_day` / `production_day`, podpowiedź w formularzu |
| Dwukolor (kolor całk./WF) | ✅ kolumny z `kolor_skrzydla_wf` / `kolor_oscieznicy_wf` |
| Ilość etykiet = ilość × mnożnik typu ościeżnicy | ✅ słownik ościeżnic Bastion z `label_multiplier`, druk etykiet (BatchPrint) |
| Naklejka, zrealizowane, zmiany-sprzedaż, promo, kolejność produkcji ościeżnic reg. | ✅ w tabeli (inline) |
| Numeracja | ✅ jeden licznik Bastion (7247 = ten sam co Excel Center) |
| Wpisał / Airtable ID / wartość konfiguratora / numer zamówienia klienta | ✅ `entered_by`, `airtable_id`, `configurator_value`, `client_order_number` |
| Bot z konfiguratora (Make) | ✅ `orders-intake` (zamiast webhooka VBA); Excel-intake jako przejściówka |
| Reklamacje | ✅ moduł Reklamacje (numeracja, powiązanie ze zleceniem, etapy) |
| Drzwi wewnętrzne (INTERIOR / SILENT) | ✅ osobna kategoria „Wewnętrzne" z wentylacją i własnym formularzem |
| Słowniki | ✅ Konfiguracja → Bastion (system, model, kolory, rozmiar, wysokość, okucia, wizjer, próg, kolekcja, ościeżnica) + wykluczenia pól |
| Statystyki | ✅ zakładka Bastion w Statystykach |
| Magazyn (stary „Oscieznice/Skrzydla-STAN") | ✅ zastąpione modułem magazynowym (porzucone w Excelu w 2023) |

## 3. Czego brakuje (do decyzji, kolejność wg wagi)

1. **Reguły domyślne z VBA** — żadna z reguł z pkt 1.3 nie istnieje w aplikacji (wysokość domyślna, 845/945, „ 92", „NISKI", „Z BOLCAMI"/„BEZ BOLCÓW", „ZAMEK LISTWOWY MACO", kolekcja z prefiksu modelu). Dziś albo wpisuje to człowiek, albo bot z Make. Do zrobienia jako **tabela reguł domyślnych** (warunki: system / ościeżnica / szerokość → pole: wartość) w Konfiguracji, stosowana w formularzu i w intake. Nie hardcodować.
2. **Partie ościeżnic regulowanych** (OŚC.REG. NOWE/KOKS) — w aplikacji jest tylko „kolejność produkcji ościeżnic reg." per zlecenie i flaga `add_to_batch`. Brakuje: partia jako obiekt (numer, zakres zleceń, firma/kolor), **etapy per partia** (panele: cięcie, frezarki, CNC, lakiernia, oklejarki; opaski: cięcie, CNC; skręcanie kpl) z inicjałami i datą. To osobny mini-moduł (jak partie w ZKP).
3. **Reszta** (progi BOLD, opaski, zabudowy kątowe) — 362 pozycje w 2026, brak odpowiednika. Opcje: (a) osobna kategoria „Bastion akcesoria" z 3 etapami (ośc. CNC, skręcanie, kontrola) i polem „do zlecenia nr", (b) pozycje dodatkowe w zleceniu Bastion. Wymaga decyzji, jak to idzie przez produkcję.
4. **Rozdział Center / Profil / Bold** — Excel trzyma 4 liczniki i 4 arkusze; aplikacja jeden licznik Bastion, `wykonawca` jest w extra_fields z importu, ale formularz Bastion nie ma wyboru wykonawcy (STA ma) i tabela Bastion nie filtruje po nim. Do dodania: picker KR Center / MR Profil w formularzu Bastion + filtr; BOLD rozpoznawalny po systemie (bez osobnej numeracji — do potwierdzenia, czy numery BOLD mają zostać osobne).
5. **Wartości specjalne etapów** (`X` nie dotyczy, `2P` dwie sztuki, `NIE FREZOWAĆ`, `WSTRZYMANE`, `BRAK OŚC`) — etap w aplikacji to inicjały albo pusto. Potrzebny co najmniej stan „nie dotyczy" i „wstrzymane" (osobny marker, nie inicjały), ilość > 1 obsłużona licznikiem sztuk per etap.
6. **Ilość etykiet LACOBEL +1** — formuła Excela dodaje etykietę dla kolekcji LACOBEL; w aplikacji mnożnik tylko po typie ościeżnicy.
7. **Podświetlenia z formatowania warunkowego** — stalowa/metalowa ościeżnica, ilość ≥ 2, „Z BOLCAMI", wiek w Reszcie/Reklamacjach (7/14 dni). W aplikacji część jest (pilne, promo), brak oznaczenia stalowej ościeżnicy i „Z BOLCAMI".
8. **Kolumna KOLEJNOŚĆ (`I`)** w arkuszu — znaczenie do wyjaśnienia (123 z 400 ostatnich wierszy ma `I`); nie przenosić w ciemno.
9. **Reklamacja „co reklamowane" komplet/skrzydło/ościeżnica** — sprawdzić, czy moduł Reklamacje ma to pole (`what_complained` jest w typie — prawdopodobnie tak).

## 4. Co można bezpiecznie zostawić w Excelu / skasować

- Ukryte arkusze magazynowe i receptury z 2023 — archiwum, nie przenosimy.
- Webhook do Make i zwrotka do Airtable — zastąpione przez intake; przy wyłączeniu Excela do usunięcia w Make.
- Słowniki „Dane formularza" — porównać z Konfiguracją Bastion w aplikacji (135 modeli vs słownik `model`), dociągnąć brakujące wartości jednorazowo.

## 5. Propozycja kolejności

1. Picker wykonawcy w formularzu Bastion + filtr (mały).
2. Tabela reguł domyślnych + zastosowanie w formularzu i intake (średni, największy zysk: koniec ręcznego dopisywania „ZAMEK LISTWOWY MACO" itp.).
3. Stany specjalne etapów (nie dotyczy / wstrzymane) — dotyczy wszystkich kategorii.
4. Partie ościeżnic regulowanych (większy, osobny etap).
5. Reszta — po decyzji, jak ma wyglądać.
