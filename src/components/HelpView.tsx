import { useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { marked } from 'marked'
import packageJson from '../../package.json'
import architekturaMd from '../../docs/ARCHITEKTURA.md?raw'

// =====================================================================
// Pomoc / instrukcja obsługi — pełna dokumentacja aplikacji.
// Sekcje z nawigacją boczną i wyszukiwarką (filtruje po tytule i słowach
// kluczowych). Treść trzymamy tu, w kodzie — zero zależności od sieci.
// =====================================================================

type Section = {
  id: string
  title: string
  keywords: string // do wyszukiwarki (małe litery)
  body: React.ReactNode
}

const SECTIONS: Section[] = [
  // ── 0. Co nowego ────────────────────────────────────────────────────
  {
    id: 'co-nowego',
    title: '✨ Co nowego (beta.47–52)',
    keywords: 'nowości zmiany changelog wersja beta reklamacje stanowisko eksport csv druk offline przerwij cofanie',
    body: (
      <>
        <h4>Wersja 1.1.4: NIP na umowie i protokole odbioru</h4>
        <ul>
          <li>Klient z NIP-em na karcie: <b>umowa</b> (PDF) ma w bloku „Zamawiający” wiersze <b>Firma</b> i <b>NIP</b> (774-000-14-54), a <b>protokół odbioru</b> bierze je z umowy. Klient bez NIP-u — dokumenty jak dotąd.</li>
          <li>Starą umowę z NIP-em dostaniesz, generując ją ponownie z karty klienta (ten sam numer umowy).</li>
        </ul>
        <h4>Wersja 1.1.3: CRM — NIP i dane firmy z GUS</h4>
        <ul>
          <li><b>Karta klienta → Edytuj dane</b> i <b>Dodaj klienta</b>: pole <b>NIP firmy</b> z przyciskiem <b>„Pobierz z GUS”</b> — wpisuje nazwę firmy, adres (ulica, kod, miejscowość), REGON, KRS i status VAT. Pustą nazwę klienta i miejscowość podpowiada z rejestru. NIP jest sprawdzany (suma kontrolna), wszystko można poprawić ręcznie.</li>
          <li>Na karcie klienta w sekcji <b>Klient</b> pokazuje się <b>Firma</b>: nazwa, NIP, adres, REGON/KRS, status VAT i skąd dane.</li>
          <li><b>Umowa</b>: adres klienta podpowiada się z adresu firmy, a NIP i nazwa firmy idą do danych umowy.</li>
          <li>Dane pobiera się teraz z wykazu podatników VAT Ministerstwa Finansów (firmy bez VAT-u tam nie ma). Pełny rejestr GUS włączy się sam po dodaniu klucza GUS.</li>
        </ul>
        <h4>Wersja 1.1.2: Wysyłki kurierem (SUUS)</h4>
        <ul>
          <li>Nowa zakładka <b>Produkcja → Wysyłki kurierem</b> (magazyn, obsługa klienta, kierownik). <b>Do wysyłki</b>: zlecenia Po Drzwi jeszcze niewydane (albo z wydaniem od dziś) i nieprzypięte do wysyłki, pogrupowane po numerze BaseLinkera (np. RACINOWSKI_1 i _2 razem).</li>
          <li><b>Wysyłka kurierem</b> na grupie albo zaznaczonych zleceniach: program podpowiada liczbę palet pionowych i poziomych, data domyślnie najbliższy dzień roboczy, palety poprawiasz przyciskami +/−.</li>
          <li><b>Zaplanowane</b> po dniach: „Gotowe (spakowane)” zdejmuje palety ze stanu Bukowej, „Nadane”, „Anuluj” (palety wracają, zlecenia wracają do „Do wysyłki”). Zmiana liczby palet do czasu nadania — stan palet koryguje się sam. Numer paczki pojawi się, gdy uzupełni go BaseLinker. Na górze podsumowanie dnia: wysyłki i palety.</li>
          <li>Palety (PALETA PIONOWA / POZIOMA, kategoria OPAKOWANIA) są w Magazyn → Stany na Bukowej jak zwykłe komponenty — ustaw im minimum, żeby działał alert.</li>
        </ul>
        <h4>Wersja 1.1.1: drzwi wewnętrzne w dwóch magazynach, WZ reklamacyjny</h4>
        <ul>
          <li><b>Magazyn 1 i Magazyn 2</b> (kody WEW1, WEW2): te same kartoteki drzwi wewnętrznych leżą na obu, stany liczone osobno. <b>Stany → Wewnętrzne</b> pokazuje kolumny Magazyn 1, Magazyn 2, <b>Razem</b>, rezerwacje, dostępne i <b>W drodze</b> (wysłane zamówienia do dostawców). W układzie „Jak w Excelu” wybierasz, co pokazuje kratka: razem albo jeden magazyn.</li>
          <li><b>Wydanie zlecenia</b> drzwi wewnętrznych zdejmuje towar automatycznie: najpierw z Magazynu 1, czego tam brakuje — z Magazynu 2. Korekta po edycji wraca tam, skąd towar zszedł.</li>
          <li>Przerzuty między magazynami: <b>Dokumenty → Przesunięcia (MM)</b>; przyjęcia: <b>Dokumenty → Przyjęcia (PZ)</b> na wybrany magazyn; inwentaryzacja osobno dla Magazynu 1 i 2 (kartka z nazwą magazynu).</li>
          <li><b>Dokumenty → WZ reklamacyjne</b>: wydanie towaru na reklamację z wybranego magazynu — firma, nr zlecenia, powód, opcjonalnie numer reklamacji z modułu Reklamacje. Zdejmuje stan od razu, numer WZR/2026/001…, PDF do podpisu (Wydał / Odebrał). „Anuluj” oddaje towar na ten sam magazyn.</li>
          <li>Ze <b>Stanów</b> (surowce) zniknęła pusta pigułka magazynu wewnętrznego — drzwi wewnętrzne są w Stany → Wewnętrzne.</li>
        </ul>
        <h4>Wersja 1.1.0: magazyn wewnętrzne jak dawny Excel, receptury „Inne” razem</h4>
        <ul>
          <li><b>Kartka do inwentaryzacji magazynu wewnętrzne</b> (Inwentaryzacja → ↓ PDF) jest ułożona jak dawny plik „STAN WEWNĘTRZNE MAGAZYN”: każda zakładka (PŁYTOWE, BRAVO, CREDIS, MALEO, MODERNA…) od nowej strony, bloki model + kolor po dwa w rzędzie, w bloku SZEROKOŚĆ / KIERUNEK / STAN / UWAGI. Ościeżnice jako tabelka profil (OR1–OR7…) × BAZA LEWA/PRAWA i BELKA 60–90, osobno ćwierćwałki i listwy opaskowe.</li>
          <li><b>Wpisywanie spisu</b> ma ten sam układ („Jak na kartce (Excel)”) — przepisujesz z kartki kratka po kratce, Enter idzie do następnej. Stary widok listy jest pod przyciskiem „Lista”.</li>
          <li><b>Magazyn → Stany → Wewnętrzne</b> pokazuje stany w tym samym układzie („Jak w Excelu”), z rezerwacjami pod liczbą; kliknięcie liczby otwiera historię ruchów.</li>
          <li><b>Receptury, część „Inne”</b>: do zlecenia schodzą wszystkie pasujące receptury (np. okapnik i samozamykacz razem). W pozostałych częściach bez zmian — jedna receptura. Dwie receptury na to samo (np. „samozamykacz” i „samozamykacz + kierunek”) dalej się wykluczają.</li>
          <li>Od tej wersji numeracja bez „beta” — kolejne wydania 1.1.1, 1.1.2…</li>
        </ul>
        <h4>Statystyki drzwi wewnętrznych: wróciły stare wykresy (beta.173)</h4>
        <ul>
          <li><b>Statystyki → Drzwi wewnętrzne</b> znów pokazują wykresy liczone ze zleceń: <b>Top 10 firm zamawiających</b>, status zamówień, czas realizacji, produkcję w czasie i rozkład per dzień tygodnia. Pod nimi zostają statystyki sprzedaży z bazy (modele, kolory, rozmiary).</li>
          <li>Zlecenie zrealizowane lub zamknięte w Optimie liczy się w statusie jako zrealizowane, także bez daty wydania w programie.</li>
        </ul>
        <h4>Drzwi wewnętrzne: komplety przesuwne i spis magazynu (beta.172)</h4>
        <ul>
          <li><b>Komplety przesuwne z Optimy</b> („MALEO 06 … Z SYSTEMEM PRZESUWNYM”) rozbijają się na dwie pozycje: skrzydło przesuwne i <b>SYSTEM PRZESUWNY</b>. System stoi w zleceniu wcięty pod swoim skrzydłem ze znaczkiem „część kompletu”, odhacza się osobno przy pakowaniu, a wydanie zdejmuje ze stanu po 1 szt. obu.</li>
          <li><b>Inwentaryzacja magazynu wewnętrzne</b>: na spisie są tylko pozycje trzymane na magazynie (skrzydła, ościeżnice, opaski… — 934 pozycje), pogrupowane i po nazwie, tak samo na kartce do liczenia. Kartoteki „w tle” (towar na zamówienie) widać po zaznaczeniu „Kartoteki w tle”.</li>
          <li>Pozycje zlecenia z towarem na zamówienie mają szary znaczek „na zamówienie” — to nie brak.</li>
        </ul>
        <h4>CRM: ceny z ulotki KR Center (beta.171)</h4>
        <ul>
          <li><b>Oferta z montażem bez cen</b> (np. wklejony sam opis „5× Verona 02 black 80, OR 10–14, Iberia czarne…”) liczy się teraz z <b>ulotki KR Center „Sierpień 2026”</b> wczytanej do CRM: skrzydła, ościeżnice, klamki i szyldy, dopłaty, osłonki. System wskazuje pozycję cennika, a kwotę wstawia program — przy każdej pozycji w PDF jest dopisek „wg cennika KR Center, str. …”. Sprawdź dobór wariantu (okleina, zamek, przedział ościeżnicy).</li>
          <li>Czego nie da się jednoznacznie dopasować (np. brak okleiny przy modelu w kilku cenach), zostaje z krokiem „Brakuje cen” i podpowiedzią, czego brakuje.</li>
          <li><b>Oferty → Do sprawdzenia</b> nie pokazuje już ofert klientów, którzy zamówili albo przegrali.</li>
        </ul>
        <h4>CRM w nowym, prostszym wyglądzie (beta.170)</h4>
        <ul>
          <li><b>Cały CRM</b> wg makiet: biały pasek sekcji, bez ikonek, jeden kolor przycisków, jedno kolorowe miejsce na ekranie — pasek <b>„Co teraz”</b>, który mówi, co kliknąć.</li>
          <li><b>Do zrobienia:</b> termin w pierwszej kolumnie (dziś / zaległe na czerwono / „sob 28.11”), „Co · Klient” i jedno zdanie, przyciski w stałych kolumnach po prawej (Zadzwoń / Sprawdź ustalenia / Otwórz ofertę | Zrobione). „Zrobione” pyta „co dalej” pod wierszem, nie na górze strony.</li>
          <li><b>Karta klienta:</b> etapy sprawy (Zapytanie → Oferta → Decyzja → Zamówienie → Umowa i pomiar → Montaż), „Co teraz” z Zamówił / Nie zamówi, trzy kolumny: Klient | Historia (jedna, z filtrem Maile / Rozmowy) | Sprawa (czego chce, oferty, dokumenty jako kroki). Wynik klikasz tylko w „Co teraz”.</li>
          <li><b>Oferta:</b> jedno pole <b>„Poproś o zmianę”</b> (cena, pozycje, treść maila) zamiast kilku. Pod nim każda prośba z odpowiedzią systemu: <i>zrobione · wersja N</i> albo na czerwono <i>nie zrobione — dlaczego</i>.</li>
          <li><b>Oferta z montażem bez cen</b> (np. sam opis bez kwot): PDF i mail nie powstają, oferta czeka z krokiem „Brakuje cen — wpisz ceny”. Pozycja ma być za darmo — napisz „… gratis”.</li>
          <li><b>Dodaj klienta:</b> źródło do wyboru — wizyta, telefon (inny numer niż Ringostat), mail, Facebook / Instagram, polecenie, inne — z polem „na który numer / kto polecił / skąd”.</li>
          <li><b>Oferty, Klienci, Zamówienia, Maile, Statystyki:</b> nagłówek z jednym zdaniem, filtry w jednym rzędzie, mniej kolumn (szczegóły w karcie).</li>
        </ul>
        <h4>Statystyki: co się sprzedaje, co spada, na co czeka klient (beta.168)</h4>
        <ul>
          <li><b>Statystyki → Drzwi wewnętrzne</b> liczą teraz towar, nie komponenty: <b>grupy modelowe</b> (VERONA, CLASSIC, MALEO…; grupa = model bez „BLACK”, linia BLACK / bezprzylgowe / norma czeska osobno), w grupie <b>kolory i rozmiary</b> (kliknij grupę), filtr typu (skrzydła, ościeżnice, klamki, osłonki, akcesoria) i wykonania (<b>WEW = z półki</b>, <b>NSTD = na zamówienie</b>), okres 3–24 miesiące. Cechy pozycji program czyta z nazwy kartoteki Optimy (słownik w bazie, rozpoznane 99 % sztuk); nierozpoznane pozycje są na dole listy, kierownik może przypisać im grupę ręcznie albo oznaczyć „to nie wewnętrzne”. Kartoteki <b>BOLD</b> w RO to Bastion, opaski CPL i klamki THEO / HAGA / FORESTA / KR CENTER to drzwi zewnętrzne — nie liczą się tu wcale.</li>
          <li><b>Trend: co spada, co rośnie</b> — porównanie okresów (miesiąc do miesiąca, 3 vs 3, 6 vs 6 miesięcy; domyślnie bez bieżącego, niepełnego miesiąca). Zmiana ponad ±10 % = <span className="badge badge-danger">spada</span> / <span className="badge badge-success">rośnie</span>, w środku <span className="badge badge-neutral">stabilne</span>, poniżej 20 sztuk w obu okresach „mało danych”.</li>
          <li><b>Braki, na które czeka klient</b> — dwa widoki: <b>Teraz czekają</b> (pozycje w otwartych zleceniach, dni od daty zlecenia do dziś) i <b>Czekały w przeszłości</b> (wydane zlecenia z ostatnich 90–365 dni, w których pozycja czekała dłużej niż 5 / 7 / 14 dni; mediana realizacji RO to 3 dni). Kolejność: najczęściej × najdłużej. Kolumna „Na magazynie” pokaże pokrycie, gdy komponenty dostaną TAK i stany po inwentaryzacji.</li>
          <li><b>STA, Disting, ST, Techniczne, Bastion</b> — pod dotychczasowym pulpitem dwie nowe karty: <b>Trend</b> po systemach / modelach / kolorach skrzydła (ten sam podział spada / rośnie / stabilne) i <b>Braki materiałowe</b> = wymuszone wydania z magazynu („[WYMUSZONE brak N]”): komponent, ile zleceń, ile brakowało, kiedy ostatnio, średnia realizacja tych zleceń vs całej kategorii, stan / rezerwacje / dostępne.</li>
          <li>Liczby liczy baza (funkcje <code>stat_wew_*</code>, <code>stat_zew_*</code>), więc zakładka Statystyki nie ściąga już 50 tys. pozycji drzwi wewnętrznych do przeglądarki.</li>
        </ul>
        <h4>Szybsze ładowanie ekranów (beta.169)</h4>
        <ul>
          <li><b>Zlecenia</b> ściągają z serwera tylko zlecenia <b>niewydane</b> — tyle, ile lista i tak pokazuje przy włączonym „Ukryj wydane”. Dotąd każde wejście w zakładkę ładowało całą historię kategorii: w Drzwiach wewnętrznych 11,6 tys. RO z Optimy (ok. 10 MB w 24 zapytaniach), w STA 4,4 tys. zleceń. Po odznaczeniu „Ukryj wydane” wydane dociągają się jak dotąd. Licznik pod filtrami mówi teraz „Niewydanych zleceń: N” zamiast „Zamówień: N”.</li>
          <li><b>Drzwi wewnętrzne:</b> po imporcie z Optimy odświeżają się pozycje tylko zmienionych zleceń, nie całej listy (3,3 tys. wierszy na każdym komputerze po każdym imporcie).</li>
          <li><b>Licznik alertów magazynu</b> (liczba w menu) był najcięższym zapytaniem bazy: 3,5 tys. wywołań po pół sekundy w jedno popołudnie (co 5 minut i po każdej serii zmian stanów, z każdego komputera). Teraz baza liczy go najwyżej raz na minutę dla całej firmy, aplikacja pyta najwyżej raz na 15 s; po własnym PZ / MM liczy się od razu.</li>
          <li><b>Wysyłka:</b> „Pokaż wydane (ost. 14 dni)” pokazuje wszystkie wydane, nie pierwsze 1000 — po dojściu RO z Optimy lista była ucinana.</li>
          <li><b>Baza:</b> poziomy braków w Stanach liczą smart ROP raz na komponent (2× szybciej), alerty tylko dla komponentów ze stanem, indeksy pod Weryfikację i Wysyłkę.</li>
        </ul>
        <h4>Magazyn wewnętrzne: „na magazynie” albo kartoteka w tle (beta.167)</h4>
        <ul>
          <li>Komponent ma pole <b>Na magazynie</b>: TAK = trzymamy na półce (inwentaryzacja, wydania zdejmują stan), NIE = kartoteka w tle — towar na zamówienie, bez stanu. Kartoteki z Optimy mają NIE.</li>
          <li>Magazyn → Komponenty pokazuje tylko TAK. „Pokaż kartoteki w tle” — reszta stronami z wyszukiwarką. TAK/NIE klikasz w wierszu, w karcie komponentu albo hurtem (zaznacz kilka → „Ustaw: …”). Przestawiają kierownicy i magazyn.</li>
          <li>Inwentaryzacja magazynu wewnętrznego i kartka PDF: tylko TAK, w grupach Skrzydła · Ościeżnice · Klamki · Akcesoria · Osłonki, w grupie po nazwie.</li>
          <li>W zleceniu pozycja z kartoteki w tle ma szary znaczek „na zamówienie” (nie brak). Status RO przychodzi z Optimy co godzinę — przy zleceniu widać „zamknięte / anulowane wg Optimy”.</li>
        </ul>
        <h4>Telefon: przygotowanie do pakowania (beta.166)</h4>
        <ul>
          <li>W wersji na telefon (osobna strona mobile — na razie bez hostingu): <b>Zlecenia → Wewn.</b> → zlecenie → lista pozycji z dużymi polami do odznaczania (grupy jak na komputerze, „Zaznacz / Odznacz wszystkie”, kto i kiedy). Na liście zleceń widać „przygotowano 3/7” albo „✓ przygotowane”.</li>
          <li>Lista Wewn. na telefonie nie pokazuje już RO zrealizowanych w Optimie (tak jak komputer).</li>
        </ul>
        <h4>Drzwi wewnętrzne: przygotowanie do pakowania (beta.165)</h4>
        <ul>
          <li>W szczegółach zlecenia przy każdej pozycji jest checkbox <b>„przygotowane”</b> — magazyn odznacza drzwi, ościeżnice, klamki… przygotowane do pakowania (jest też „Zaznacz wszystkie”). Po najechaniu widać, kto i kiedy odznaczył.</li>
          <li>Na liście kolumna <b>Przygotowanie</b>: np. 6/10 albo „✓ komplet”. Biuro widzi zmiany na żywo.</li>
          <li>Odznaczają kierownicy i magazyn (magazynier, pracownik działu magazyn); pozostali widzą tylko podgląd. Odznaczenia przeżywają zmianę RO w Optimie (liczą się po linii RO).</li>
        </ul>
        <h4>Statystyki: udział konfiguratora bez Technicznych i Drzwi wewnętrznych (beta.164)</h4>
        <ul>
          <li>Statystyki → Konfigurator i „% z konfiguratora” w Statystyki → Firmy liczą tylko kategorie, które konfigurator wysyła — Techniczne i Drzwi wewnętrzne nie zaniżają już udziału.</li>
        </ul>
        <h4>CRM: przycisk „Umowa” zawsze widoczny (beta.163)</h4>
        <ul>
          <li>Na karcie klienta przyciski <b>Umowa</b> i <b>Protokół odbioru</b> są zawsze widoczne. Gdy jeszcze nie można ich użyć, są wyszarzone, a po najechaniu mówią, co zrobić (np. najpierw „Oferta z montażem”, poczekać aż się policzy, oferta bez montażu nie wystarczy, protokół robi się do umowy).</li>
          <li>Umowę można zrobić także z oferty <b>Zaakceptowanej</b> (np. po oznaczeniu klienta jako „Zamówił”) — wcześniej przycisk wtedy znikał.</li>
        </ul>
        <h4>Drzwi wewnętrzne: tylko otwarte RO z Optimy (beta.161)</h4>
        <ul>
          <li>Import ściągnął RO z całego roku. Te, które w Optimie są <b>zrealizowane</b> (stan 3) albo <b>zamknięte</b> (stan 4), mają taki status w programie, są domyślnie ukryte (przełącznik „Pokaż zrealizowane w Optimie”) i <b>nie rezerwują</b> magazynu wewnętrznego. Nie ma przy nich „✓ Wydane”.</li>
          <li>Lista ładuje pozycje tylko otwartych zleceń — szczegóły zamkniętego RO dociągają je przy otwarciu. Zakładka i odświeżanie podczas importu dużo mniej obciążają bazę.</li>
        </ul>
        <h4>CRM: szybsze przejścia (beta.160)</h4>
        <ul>
          <li>Powrót z karty klienta do listy (i przełączanie Do zrobienia / Oferty / Zamówienia / Klienci / Maile / Statystyki) jest natychmiastowy — lista zostaje w pamięci z tym samym wyszukiwaniem, filtrem i miejscem przewinięcia, a dane odświeżają się po cichu w tle.</li>
          <li>Karta klienta ładuje wszystko jednym rzutem zamiast trzech po kolei.</li>
          <li>Lista klientów nie czeka na sprawdzanie duplikatów; samo sprawdzanie w bazie liczy się ok. 25× szybciej.</li>
        </ul>
        <h4>Drzwi wewnętrzne z Optimy na prawdziwych danych (beta.159)</h4>
        <ul>
          <li>Lista: kolumna <b>Skrzydła</b> (przy RO z Optimy liczy import — same skrzydła, bez ościeżnic i klamek) i filtr <b>Zawiera: Skrzydła / Tylko ościeżnice</b>.</li>
          <li>Szczegóły zlecenia: pozycje w grupach <b>Skrzydła · Ościeżnice i opaski · Klamki · Osłonki · Akcesoria</b> z sumą przy każdej grupie (listwy w kpl liczone osobno).</li>
          <li>Kolumna <b>Stan</b> przy pozycjach: stan magazynu wewnętrznego i <b>brak</b>, gdy jest mniej, niż trzeba wydać. „✓ Wydane” pokazuje braki przed potwierdzeniem — wydanie i tak przejdzie, ale stan zejdzie poniżej zera.</li>
          <li>Pasek Optimy i Ustawienia → Integracje: „⟳ trwa synchronizacja”, gdy import właśnie działa.</li>
          <li>Akcesoria (zamki, wkładki, tulejki, kratki) liczą się do drzwi wewnętrznych także w Alertach, Prognozie i Zamawianiu.</li>
        </ul>
        <h4>Magazyn wewnętrzne: kartoteki z Optimy, inwentaryzacja otwarcia, rezerwacje (beta.158)</h4>
        <ul>
          <li>Komponenty drzwi wewnętrznych zakłada import kartotek Optimy (kod jak w Optimie, więc pozycje RO podpinają się same). Nowa kategoria <b>Akcesoria</b> (zamki, wkładki, skrócenia). Takiego komponentu nie da się usunąć — przycisk „Dezaktywuj” chowa go z list; w edycji zmieniasz tylko logistykę (dostawca, palety, minimum), kod, nazwa i cechy są z Optimy.</li>
          <li><b>Inwentaryzacja</b> przy kilku tysiącach pozycji: wyszukiwarka (kod, nazwa, model, kolor, rozmiar), filtry kategorii / modelu / koloru, strony po 100, <b>Enter = następna pozycja</b> (na końcu strony przechodzi na kolejną) i „Tylko z ilością &gt; 0”. Inwentaryzację otwarcia magazynu wewnętrznego otwierasz jak dotąd — spis bierze wszystkie aktywne drzwi wewnętrzne ze stanem 0; zatwierdzenie tworzy korekty INW.</li>
          <li><b>Magazyn → Stany → Wewnętrzne</b>: drzwi wewnętrzne z tymi samymi filtrami, kolumny <b>Rezerwacje</b> (pozycje otwartych zleceń, które jeszcze nie zeszły ze stanu) i <b>Dostępne</b> = stan − rezerwacje.</li>
          <li>Bastion (także Bastion Interior) nie należy do drzwi wewnętrznych — nie ma go w wyszukiwarce „Powiąż z komponentem”.</li>
        </ul>
        <h4>Drzwi wewnętrzne z Optimy (beta.157)</h4>
        <ul>
          <li>Rezerwacje odbiorcy (RO) z pozycjami drzwi wewnętrznych z baz <b>KR Center</b> i <b>MR Profil</b> same wpadają do zakładki Drzwi wewnętrzne (import co godzinę). Lista ma kolumny: nr RO, źródło (plakietka bazy albo „Ręczne”), firma, nr zamówienia klienta, data RO, pozycje, <b>bez komponentu</b> i status; nowe filtry: źródło, baza, „Tylko bez komponentu”. RO anulowane w Optimie są wyszarzone (powód w dymku) i domyślnie ukryte — pokazuje je „Pokaż anulowane”.</li>
          <li>W szczegółach zlecenia z Optimy dane z RO (firma, nr klienta, data, odbiorca, opis, pozycje) są tylko do odczytu — zmieniasz je w Optimie. Edytować można pola produkcyjne (wentylacja), wydawać i rozliczać magazyn.</li>
          <li>Pozycja bez komponentu magazynu ma znacznik ⚠ i przycisk <b>„Powiąż z komponentem”</b>: powiązanie robisz raz na kod towaru z Optimy — od razu dostają go wszystkie pozycje z tym kodem i kolejne RO. Wszystkie kody naraz (z masowym przypisaniem) są w <b>Magazyn → Komponenty → Kody Optimy</b>. Powiązania zmieniają kierownicy i magazynier.</li>
          <li>„✓ Wydane” przy zleceniu z Optimy zdejmuje pozycje z magazynu wewnętrznego i ostrzega, ile pozycji bez komponentu zostanie pominiętych. Po późniejszym powiązaniu kodu — „Dolicz wydanie z magazynu”. RO anulowane w Optimie po wydaniu: „Zwróć wydany towar”.</li>
          <li>Stan importu (ostatnie uruchomienie, liczniki, błędy) dla obu baz: nad listą i w <b>Ustawienia → Integracje → Optima → Drzwi wewnętrzne</b>. Kierownicy mają „Synchronizuj teraz” (wynik po 1–2 minutach).</li>
        </ul>
        <h4>CRM → Zamówienia: lista zamówień od razu na wierzchu (beta.156)</h4>
        <ul>
          <li>Zamiast długiej listy ostrzeżeń nad tabelą jest jeden przycisk „⚠ N zamówień wymaga uwagi” (włącza filtr), a powód stoi w wierszu zamówienia pod numerem. Otwarte zlecenia KR Po Drzwi bez pary w sklepie są zwinięte w jednej linijce — rozwijasz, gdy chcesz je powiązać.</li>
          <li>Zamówienie z gotowym listem przewozowym, a bez zlecenia KR, nie jest już „Brak zlecenia” (towar spakowany, drzwi spoza KR Center).</li>
        </ul>
        <h4>CRM → Zamówienia: list przewozowy i przesyłki kurierskie (beta.155)</h4>
        <ul>
          <li>Nowa kolumna <b>Wysyłka</b> ze stanem przesyłek z Baselinkera: <b>List gotowy</b> (list przewozowy wygenerowany, kurier jeszcze nie odebrał — przygotowane do wysyłki), <b>U kuriera</b>, <b>Doręczone</b>, <b>Problem z paczką</b> (nie doręczona, zwrot, zagubiona). Nowy filtr „Przygotowane do wysyłki”.</li>
          <li>Paczka u kuriera albo doręczona oznacza zamówienie jako <b>Wysłane</b>, a w kolumnie Termin pokazuje „u kuriera (data)” albo „doręczone data”.</li>
          <li>W karcie zamówienia sekcja <b>Przesyłki</b>: numer listu, kurier, status i data ostatniego skanu. Statusy przesyłek sprawdzają się co godzinę, aż paczka dojdzie; „Odśwież z Baselinkera” w karcie sprawdza od razu.</li>
          <li>Wymaga uwagi: zwrot / niedoręczona / zagubiona paczka (poza zamówieniami zrealizowanymi i usuniętymi) oraz list przewozowy wygenerowany, gdy zlecenie KR jest jeszcze w produkcji (zwykle nieodhaczone etapy).</li>
        </ul>
        <h4>CRM → Zamówienia: mniej fałszywych „Brak zlecenia” (beta.154)</h4>
        <ul>
          <li>Po pierwszym pobraniu z Baselinkera: drzwi wewnętrzne „Dostępne od ręki” (z magazynu) i akcesoria „do drzwi” (okapnik, wizjer, podwalina) mają status <b>Bez produkcji</b>, nie „Brak zlecenia”. Zlecenia wymagają tylko drzwi zewnętrzne i wewnątrzklatkowe (Bastion, Titan).</li>
          <li>Zamówienie bez zlecenia ze statusem w sklepie „Zrealizowane” albo „Wysłane” nie jest już alarmem; „Usunięte” liczy się jak anulowane.</li>
          <li>Otwarte zlecenie z numerem BL, którego zamówienia nie ma w Baselinkerze (stare, w archiwum BL), ma w pasku „wymaga uwagi” własny opis — to zwykle zlecenie do zamknięcia.</li>
        </ul>
        <h4>CRM: zakładka Zamówienia — zamówienia ze sklepu razem z produkcją (beta.153)</h4>
        <ul>
          <li><b>CRM Po Drzwi → Zamówienia</b> (#144/#153): każde zamówienie z Baselinkera od 1.11 (także akcesoria) z tym, co dzieje się z nim w KR Center. W wierszu: numer BL, klient, co zamówił, kwota i wpłata, status w sklepie, <b>status produkcji jednym słowem</b> (Brak zlecenia / W produkcji / Częściowo gotowe / Gotowe / Wysłane / Reklamacja / Bez produkcji / Anulowane), zlecenia KR z paskiem etapów i termin (dzień produkcji, „na magazynie od”, „wyjechało” z trasą).</li>
          <li><b>Wymaga uwagi:</b> opłacone ponad dobę temu, a nie ma zlecenia; gotowe albo wysłane, a w sklepie nadal status produkcyjny; anulowane w sklepie przy otwartym zleceniu; otwarte zlecenia Po Drzwi bez pary w sklepie (z przyciskiem „powiąż” i podpowiedzią po nazwisku).</li>
          <li><b>Karta zamówienia</b> (kliknięcie wiersza): klient i dostawa, płatność, uwagi, pola dodatkowe z BL (np. RO, faktury), pozycje z atrybutami, zlecenia KR z etapami i RO, reklamacje. Przyciski: Odśwież z Baselinkera, Otwórz w Baselinkerze, Strona klienta, Klient w CRM (znajdzie po telefonie / mailu albo założy jako „Zamówił”), ręczne powiązanie i odpięcie zlecenia, „otwórz zlecenie” w zakładce kategorii.</li>
          <li>Zlecenie łączy się z zamówieniem samo po 8-cyfrowym numerze BL na początku „nr zamówienia klienta” (tak zapisuje automat z Make). Dane z Baselinkera odświeżają się co 15 minut; aplikacja niczego w Baselinkerze nie zmienia (zmiana statusu, mail i reklamacja z karty to etap 2).</li>
          <li><b>Ustawienia → Baselinker</b> (właściciel): token API Baselinkera trafia do sejfu Supabase; bez niego zakładka jest pusta. Tam też stan ostatniego pobrania i „Pobierz teraz”.</li>
        </ul>
        <h4>Magazyn: minimum logistyczne komponentu, równe plakietki w NR ZLECENIA, Biurko logistyki (beta.152)</h4>
        <ul>
          <li><b>Tabele zleceń → NR ZLECENIA:</b> plakietki znów stoją w równych kolumienkach (Tymek 24.11): ⚠️ weryfikacji, wykonawca, 💬 komentarze (także z licznikiem) i status magazynu mają stałe miejsca; rzadkie plakietki (⚠ problem, „ark. N”) stoją na końcu, a RO z Optimy zawsze w osobnej linijce pod numerem.</li>
          <li><b>Biurko logistyki:</b> gdy zlecenie jest <b>NA MAGAZYNIE</b>, ostrzeżenie „niekompletny komplet: …” (nieodhaczone etapy) znika — towar już jest, brakuje tylko ptaszków. Niedobór magazynowy, szyba, PILNE i problem zostają.</li>
          <li><b>Etapy z Excela → magazyn:</b> etap uzupełniony z arkusza (nocny przebieg i „na żywo”) wydaje materiał tak samo jak odhaczenie w programie — rezerwacje etapu stają się WZ, a przy braku na stanie wydanie jest wymuszone (stan na minusie, WZ z dopiskiem „WYMUSZONE”, dokument bez osoby). Rezerwacje z pierwszego zapisu 24.11 dogonione.</li>
          <li><b>Karta komponentu → Logistyka i zamawianie:</b> nowe pole <b>Minimum logistyczne</b> (#168, Tymek) — w jakiej wielokrotności dostawca sprzedaje dany SKU, np. 8 albo 12 szt., gdy na palecie jest 24. Istniejące i nowe komponenty mają 1 (sztuki); wyczyszczone przy edycji = pełna paleta.</li>
          <li><b>Stany → DO ZAMÓWIENIA</b>, eksport braków do CSV, „Braki → lista zakupowa”, sugestie w Zamawianiu i krok ilości na liście zakupowej zaokrąglają się w górę do tej wielokrotności. Koniec podpowiedzi „zamów 1 skrzydło” tam, gdzie wpiszesz minimum. Liczenie palet i TIR-ów bez zmian.</li>
        </ul>
        <h4>Klienci: scalanie przy tym samym numerze, cena z rozmowy jako wartość, bez zadań „oddzwoń” (beta.151)</h4>
        <ul>
          <li><b>Dane klienta:</b> gdy wpisany telefon albo e-mail ma już inny klient (np. drugi wpis z zamówienia ze sklepu), zamiast błędu pytanie „Ten klient już jest — połączyć?”. Po potwierdzeniu oferty, rozmowy, maile i historia tamtego wpisu przechodzą do karty, na której jesteś, a tamten wpis znika.</li>
          <li><b>Wartość klienta:</b> cena orientacyjna, którą handlowiec podał klientowi w rozmowie, mailu albo notatce, od razu jest wartością klienta w lejku, dopóki nie ma oferty ani wartości wpisanej ręcznie. W Kontaktach ma znaczek „~”, na karcie etykietę „Wartość (wstępnie z rozmowy)”.</li>
          <li><b>Zadania:</b> „Oddzwoń” zniknęło z listy zadań. Nieodebrana rozmowa zostaje w historii klienta bez zadania; prośba klienta o kontakt to „Dopytaj”.</li>
          <li><b>Mail oferty:</b> pisze się w stylu osoby, która zleciła ofertę (także po „Ustalenia OK”, „Przelicz” i „Ponów”), nie w stylu domyślnym.</li>
          <li><b>Zamówienie ze sklepu:</b> klient z CRM, który złożył zamówienie w sklepie, sam staje się „Zamówił” z kwotą zamówienia jako wartością; zadanie się zamyka (przy nietypowej adnotacji zostaje „Dopytaj”).</li>
        </ul>
        <h4>Zamówienia u dostawców na żywo (beta.150)</h4>
        <ul>
          <li><b>Magazyn → Zamawianie:</b> zamówienie u dostawcy wygenerowane na jednym komputerze pojawia się u wszystkich od razu (po ok. 1,5 s), bez przechodzenia między zakładkami. Tak samo zmiany statusu i pozycji zamówienia.</li>
        </ul>
        <h4>Lista zakupowa: minimum z półek naprawdę widoczne (beta.149)</h4>
        <ul>
          <li><b>Zamawianie → lista zakupowa:</b> minimum półki wpisane w Magazyn → Stany wreszcie pokazuje się w kolumnach „Stan / Min” i „Do minimum” oraz w podpowiedziach przy dostawcy. Od beta.145 lista miała je sumować, ale wczytywanie stanów gubiło tę kolumnę po drodze i wszędzie było „—”.</li>
        </ul>
        <h4>Pytanie przed telefonem; oferta bez dobranego produktu pyta, zamiast czekać (beta.148)</h4>
        <ul>
          <li><b>Dzwonienie z aplikacji:</b> klik w numer telefonu najpierw pyta „Zadzwonić do …?”, bo program do dzwonienia wybiera numer od razu. Przypadkowy klik nie dzwoni do klienta.</li>
          <li><b>Oferta bez dobranego produktu:</b> gdy system nie znajdzie w sklepie produktu do ustaleń z rozmowy, zamiast kręcić „w przygotowaniu” zadaje 2–5 pytań (jakie drzwi, linia, wzór, rozmiar). Odpowiedz na ekranie oferty albo dopytaj klienta, a oferta policzy się od nowa po zapisaniu. Na liście ofert taka oferta ma „czeka na odpowiedzi”.</li>
          <li><b>Dobór produktu:</b> drzwi dodatkowe wspomniane przy okazji (np. „do tego drzwi wewnętrzne z magazynu, modele wybiorę sam”) nie blokują wyceny głównych drzwi; mail wspomina o nich osobno i podaje link do kategorii drzwi dostępnych od ręki.</li>
        </ul>
        <h4>Numery telefonu jako linki (beta.147)</h4>
        <ul>
          <li><b>Dzwonienie z aplikacji:</b> numer telefonu klienta jest linkiem — klik otwiera domyślny program do dzwonienia w Windows (np. Ringostat Smart Phone) z wpisanym numerem. Obok numeru jest „kopiuj”. Program trzeba raz ustawić jako domyślny dla linków TEL (Ustawienia → Aplikacje → Aplikacje domyślne → według typu linku → TEL).</li>
        </ul>
        <h4>Szukanie zleceń kilkoma słowami naraz (beta.146)</h4>
        <ul>
          <li><b>Lista zleceń → szukaj:</b> wpisz kilka słów, a każde musi pasować do któregoś pola zlecenia (numer, numer RO, arkusz, firma, system, model, kolor, numer klienta). np. „231/11 antracyt” = numer RO i kolor. Jedno słowo działa jak dotąd.</li>
          <li><b>Reklamacje z Excela:</b> Disting Plus z arkusza STA dopinany jak etapy produkcji: skrzydło pod zleceniem STA, ościeżnica pod Distingiem.</li>
        </ul>
        <h4>Lista zakupowa: minimum z półek; porządek w rezerwacjach (beta.145)</h4>
        <ul>
          <li><b>Zamawianie → lista zakupowa:</b> minimum brane z karty komponentu, a gdy puste, z sumy minimów półek ustawionych w Magazyn → Stany (dotąd lista pokazywała „—”, bo karta komponentu minimum nie ma). Działa w podpowiedziach przy dostawcy, znaczniku „poniżej min” i pozycjach listy. Kolumny po polsku: „Stan / Min”, „Do minimum” (dawne „Runway”), „Stan / Min / Cel”.</li>
          <li><b>Magazyn:</b> rezerwacje otwartych zleceń sprzed 7.10 (miesiąc przed inwentaryzacją 6.11) anulowane bez rozchodu: 187 zleceń, 3327 rezerwacji, głównie Disting. Zlecenia zostają otwarte, stany bez zmian, braków krytycznych ubyło.</li>
        </ul>
        <h4>Porządek nazw firm, Titan liczony raz, reklamacje z Excela, eksport stanów (beta.144)</h4>
        <ul>
          <li><b>Statystyki → Firmy:</b> warianty pisowni jednej firmy (wielkość liter, ogonki, „#”, powtórzone słowo) liczą się razem same. Resztę („PO DRZWI” = „PO DRZWI ŻORY”) kierownik scala w panelu <b>„Porządek nazw firm”</b> (podejrzane warianty, wybór nazwy docelowej, „Scal” / rozdziel). Scalenie działa też w „top firm” w statystykach kategorii i reklamacji. <b>Titan</b> (STA + ST + Bastion) i <b>Disting Plus</b> (Disting + STA) liczone raz, a nie z każdego arkusza osobno.</li>
          <li><b>Jedna pisownia kontrahenta:</b> każde nowe zlecenie (konfigurator, Excel, API, ręcznie) dostaje nazwę firmy z listy Kontrahentów albo z aliasu; nazwa, jaka przyszła, zostaje zapisana w zleceniu.</li>
          <li><b>Reklamacje z Excela:</b> nocna synchronizacja czyta arkusze „Reklamacje” ze skoroszytów STA, Disting, ST i Bastion (ostatni rok). Numery <code>XL/&lt;kategoria&gt;/&lt;nr&gt;</code>, etapy naprawy i wydanie z arkusza; reklamacja bez wydania jest otwarta (zakładka Reklamacje, zadania naprawy na mobilnym). Statystyki → Reklamacje: wykres miesięczny po dacie reklamacji, nie dacie wpisu.</li>
          <li><b>Magazyn → Stany</b> (zgłoszenie #165): po zaznaczeniu półek przycisk <b>„Eksport CSV”</b> zapisuje zaznaczone wiersze w tym samym układzie kolumn co eksport braków.</li>
        </ul>
        <h4>Poprawki: biurko logistyki, daty, menu, podgląd dokumentów (beta.143)</h4>
        <ul>
          <li><b>Wysyłka → biurko logistyki:</b> w uwagach zlecenia znów widać „problem” zgłoszony z hali (z powodem). „Schowaj już oznaczone” i wyszukiwanie tylko ukrywają wiersze — liczniki, lista do fakturowania i „Trasa wyjechała” zawsze biorą całą trasę, razem z oznaczonymi zleceniami.</li>
          <li><b>Daty:</b> „dziś” zapisywane po polskim czasie, a nie w UTC — po północy program nie wpisuje już wczorajszej daty (data wydania, data zlecenia, reklamacje, etykieta Bastion, nazwy plików). Liczenie dni roboczych nie gubi dnia po marcowej zmianie czasu.</li>
          <li><b>Zwinięte menu</b> (zgłoszenie #163): zamiast liczby nad ikoną jest kropka w rogu ikony, a liczba w dymku po najechaniu (np. „Magazyn — 213”); kropka pokazuje się też przy grupie, w której akurat jesteś.</li>
          <li><b>Etykiety → Dokumenty:</b> spóźniony podgląd nie podmienia już dokumentu klikniętego później i nie otwiera okna, które zostało zamknięte.</li>
        </ul>
        <h4>Aktualizacje wymagane naprawdę (beta.137)</h4>
        <ul>
          <li><b>Wymagana aktualizacja:</b> gdy kierownik ustawi minimalną wersję, program sprawdza ją co kwadrans i po powrocie do okna — także na stanowiskach, które chodzą od rana. Ekran „Wymagana aktualizacja” od razu proponuje „Pobierz i zainstaluj”; przy kłopocie z pobieraniem jest „Pobierz instalator ręcznie”.</li>
        </ul>
        <h4>Wydania Bastionu i Titanów z Excela (beta.134)</h4>
        <ul>
          <li><b>Wydania z Excela (nocna synchronizacja):</b> zlecenia Bastion, które od kilku dni stały jako „duplikat” (jeden wiersz arkusza pasował do dwóch zleceń), zamykają się już same po pewnym dopasowaniu. Titany w arkuszu ST zamykają się po zaznaczeniu „ETAP 4” (montaż, pakowanie i kontrola jakości) — razem z częścią Bastion.</li>
        </ul>
        <h4>Biurko logistyki: w uwagach tylko realne braki (beta.130–131)</h4>
        <ul>
          <li>W wierszu zlecenia nie pokazujemy już „brak receptury" ani „częściowa receptura" — to sprawa magazynu i receptur, nie logistyki. Zostają: niedobór magazynowy, szyba jeszcze nie przyszła, niekompletny komplet, PILNE, zgłoszony problem oraz uwagi wpisane ręcznie w zleceniu.</li>
          <li>Przy liście do fakturowania zniknął dopisek o cenach i automacie faktur (beta.131) — na biurku ma być tylko to, co potrzebne do pracy.</li>
        </ul>
        <h4>Samozamykacz w zleceniach STA i Disting, także jako kryterium receptur (beta.129)</h4>
        <ul>
          <li><b>Zlecenia STA / Disting:</b> nowe pole <b>Samozamykacz</b> w formularzu (obok Osłonek), w szczegółach zlecenia, na stanowisku (dane skrzydła i pakowanie), w historii zmian, w archiwum i jako pole etykiety <code>{'{{samozamykacz}}'}</code>. Wartości w <b>Konfiguracja → STA / Disting → Samozamykacz</b> (na start BRAK i TAK; konkretne modele dopisuje biuro). Przy zleceniach Disting Plus pole przenosi się między STA a Distingiem jak reszta wspólnych danych.</li>
          <li><b>Magazyn → Receptury:</b> nowe kryterium „Samozamykacz” — receptura z tym kryterium dobiera komponent tylko do zleceń, które mają samozamykacz; zmiana pola w zleceniu przerezerwowuje komponenty.</li>
          <li><b>Statystyki → Firmy</b> (zgłoszenie #118): wpisz albo wybierz firmę (lista od najczęściej zamawiających; nazwa „zawiera” łapie warianty pisowni i liczy je razem) i okres (3–24 miesiące albo cały). Kafelki: zlecenia i sztuki, w realizacji, reklamacje (na 100 zleceń), średni czas realizacji z medianą, udział konfiguratora; wykresy: zamówienia i reklamacje w czasie, kategorie, top 10 modeli i kolorów; tabela ostatnich 20 zleceń z dniami realizacji. Wybór firmy i okresu pamiętany na komputerze.</li>
          <li><b>Excel:</b> automat czyta kolumnę „Samozamykacz” z arkusza i formularza. Dopóki arkusze STA i Disting jej nie mają, zlecenia z Excela mają pole puste i receptura z tym kryterium ich nie obejmie (zgłoszenie #157, Dawid).</li>
        </ul>
        <h4>Biurko logistyki: odbiór osobisty, montaż własny i firmy bez trasy (beta.128)</h4>
        <ul>
          <li>Lista „Trasa” ma poza dniami tygodnia także <b>Odbiór osobisty</b>, <b>Montaż własny</b> (aluminium) i <b>Bez trasy</b> (firma bez ustawionego dnia trasy w Kontrahentach), z liczbą zleceń przy każdej pozycji. Oznaczanie do fakturowania, lista do druku i „Dodaj do trasy” działają tam tak samo.</li>
          <li>Przy trasie specjalnej dzień produkcji pokazuje „—”; przycisk wyjazdu nazywa się odpowiednio „Odebrane osobiście”, „Wyjechało na montaż” albo „Trasa wyjechała”.</li>
        </ul>
        <h4>Wysyłka: biurko kierownika logistyki (beta.127)</h4>
        <ul>
          <li><b>Wysyłka → „Biurko logistyki”</b> (przełącznik obok „Lista zleceń”, wybór pamiętany na komputerze): wybierasz dzień produkcji, trasa ustawia się sama (czwartek → poniedziałek). Firma po firmie oznaczasz zlecenia <b>do fakturowania</b> (ten sam znacznik co kolumna FAKTURA, nic go nie blokuje), „Oznacz wszystkie”, „Schowaj oznaczone”. Wiersz: pasek z lewej (zielony = na magazynie wysyłkowym), numer, model, system, kolor, rozmiar z kierunkiem, sztuki, kategoria; pod spodem nr klienta, RO z Optimy („BRAK RO” tylko przy zleceniach z konfiguratora), data złożenia z wiekiem, ostrzeżenia (szyba, komplet, niedobór). Nic się nie zawija, pełne uwagi po najechaniu, „Szczegóły” rozwija kolor/wymiar, magazyn, szybę, uwagi i „Otwórz zlecenie”.</li>
          <li><b>„Na magazynie”</b>: STA i Titan-skrzydło po wydaniu z Excela (przekazane z Marklowickiej na Bukową), reszta po komplecie etapów. Wydań z Excela nic nie zmienia.</li>
          <li><b>„Dodaj do trasy zlecenie nr”</b> dopina zlecenie z innej trasy (przy numerze powtarzającym się między kategoriami pyta, które); plakietka „dodane do trasy” przez 7 dni, „Odepnij” w szczegółach.</li>
          <li><b>„Lista do fakturowania (N)”</b>: zestawienie per firma bez cen (nr, kategoria, model, system · kolor · rozmiar, szt., nr zamówienia klienta, RO) do druku / PDF.</li>
          <li><b>„Trasa wyjechała”</b> (kierownik): zapisuje wyjazd wszystkich widocznych zleceń trasy jako osobne zdarzenie; wiersze zostają do końca dnia z godziną, jutro znikają; „Cofnij wyjazd” w szczegółach, gdy coś zostało na hali.</li>
        </ul>
        <h4>Szablony etykiet; RO w fakturowaniu (beta.126)</h4>
        <ul>
          <li><b>Konfiguracja → Szablony etykiet:</b> przy każdym polu przycisk <b>„if”</b> wstawia pole w warunku <code>{'{if pole}…{/if}'}</code>, opis warunków widać pod listą, a <b>„Owiń wiersze tabeli warunkami”</b> robi to dla całego szablonu jednym klikiem (wiersz z pustym parametrem znika zamiast „-”). Szablony STA, Disting i Aluminium są już owinięte; kopie sprzed zmiany można usunąć.</li>
          <li><b>Wysyłka → FAKTURA:</b> pod checkboxem numer RO z Optimy (pełny po najechaniu) i plakietka „RO …” w szczegółach zamówienia.</li>
        </ul>
        <h4>Zgłoszenia z 16.11: konfigurator w Statystykach, pozycje w szkicu ZD (beta.125)</h4>
        <ul>
          <li><b>Statystyki → Konfigurator:</b> ile procent zleceń przychodzi z konfiguratora, miesiąc po miesiącu, z linią celu 50% (koniec 2027). Kafelki: bieżący i poprzedni miesiąc, cały okres; linie per kategoria do włączenia; tabela wg kategorii. Liczone po dacie zamówienia, bez anulowanych.</li>
          <li><b>Zamawianie → szkic ZD:</b> po „Edytuj pozycje” pod tabelą jest „Dodaj pozycję” (komponenty tego dostawcy na górze), a przy każdej pozycji „Usuń”. Ostatniej pozycji nie da się usunąć — wtedy anuluj całe zamówienie.</li>
        </ul>
        <h4>Podgląd etykiety z przewijaniem, kolor „Utwórz reklamację" (beta.103)</h4>
        <ul>
          <li><b>Druk etykiety: podgląd da się przewinąć</b> (#141) — ramka podglądu przewija się, a sama etykieta ma w niej swój prawdziwy rozmiar.</li>
          <li><b>„Utwórz reklamację" w Zakończonych</b> (#140) ma kolor ostrzegawczy zamiast większego rozmiaru. Czerwony zostaje dla akcji niszczących.</li>
        </ul>
        <h4>Receptury: przeliczanie rezerwacji bez „limitu czasu" (beta.102)</h4>
        <ul>
          <li><b>Zapis receptury nie przelicza już od razu całej kategorii</b> (#139, Dawid): przeliczenie rusza 15 s po ostatniej zmianie receptury, więc seria zapisów to jedno przeliczenie. Porcje są mniejsze (40 zleceń, ok. 4–5 s), a gdy baza mimo to przerwie zapytanie limitem czasu, porcja maleje i idzie jeszcze raz zamiast przerywać całość. Jeśli w trakcie zmienisz kolejną recepturę, po zakończeniu pójdzie drugi przebieg.</li>
        </ul>
        <h4>Numer z arkusza Excel obok numeru zlecenia (beta.100)</h4>
        <ul>
          <li><b>Szara plakietka „ark. N" za numerem zlecenia</b> (tabele zleceń, Moje stanowisko) pokazuje numer, pod którym to zlecenie figuruje w arkuszu Excel, gdy różni się od numeru w aplikacji. Podpowiedź mówi, skąd numer i kiedy go odczytano. <b>Wiążący dla hali jest numer z aplikacji</b> (ustalenia 13.11) — plakietka jest informacją, żeby biuro i hala mówiły o tym samym zleceniu.</li>
          <li><b>Codzienna synchronizacja z Excela (20:00) odświeża ten numer</b> dla każdego dopasowanego otwartego zlecenia, więc po przesunięciu wierszy w arkuszu plakietka nadąża. Kreskowana ramka = numer z chwili importu, jeszcze niepotwierdzony synchronizacją.</li>
          <li>Na etykietach pole „Nr z arkusza" bierze ten sam numer.</li>
        </ul>
        <h4>Słowniki bez kasowania, „Zakończone", kontrast i odstępy (beta.97)</h4>
        <ul>
          <li><b>Pozycji słownika i kontrahenta użytych w zamówieniach nie da się usunąć</b> (#105). Przy próbie usunięcia aplikacja mówi, w ilu zamówieniach (aktywnych i w archiwum) wartość występuje, i proponuje zmianę nazwy. Pilnuje tego też baza, więc nic nie zniknie z historii.</li>
          <li><b>Zakładka „Archiwum" nazywa się „Zakończone"</b> (#108) — to zrealizowane zamówienia po archiwizacji, nie koniec gwarancji. Uprawnienia i wyszukiwanie bez zmian.</li>
          <li><b>Wysyłka: plakietki „po terminie" i „blisko terminu"</b> (#122) mają biały tekst — wcześniej reguła koloru filtra malowała je na czerwono na czerwonym tle.</li>
          <li><b>Nagłówek kolumny Akcje</b> (#130) nie chowa się już pod komórkami przy przewijaniu tabeli w pionie — miał niższą warstwę niż przyklejone komórki Akcji poniżej.</li>
          <li><b>Pasek podzakładek</b> (#124) ma odstęp od linii i od tabeli lub filtrów pod nią.</li>
          <li><b>Wyłącznik „problem / ⚠️" w legendzie</b> (beta.98–99) chowa razem pomarańczowe oznaczenie problemu i żółte ⚠️ „wymaga weryfikacji" po imporcie. Tylko wizualnie, na tym komputerze — zlecenia i zakładka Weryfikacja bez zmian.</li>
        </ul>
        <h4>Drobne poprawki po zgłoszeniach Łukasza (beta.96)</h4>
        <ul>
          <li><b>Zamknięcie okna drukarki bez wydruku</b> (#128) to już nie „Błąd druku: nieznany", tylko informacja „Zamknięto okno bez wydruku". Przy okazji Etykiety → Dokumenty pokazują prawdziwy powód odmowy druku PDF (np. drukarka offline) — wcześniej zawsze „nieznany", bo czytały złe pole odpowiedzi.</li>
          <li><b>Kosmetyka:</b> plakietki RO i braków mają odstęp od sąsiadów (#131), sekcja „Pochodzenie (BOT)" w edycji zamówienia ma margines boczny (#136), małe przyciski trzymają ikonę optycznie na środku (#137/#138).</li>
        </ul>
        <h4>Po zgłoszeniach Łukasza i Mariusza (beta.95)</h4>
        <ul>
          <li><b>Flaga „problem" na zleceniu (#87).</b> Hala w Moim stanowisku klika „⚠ Problem" i wpisuje powód (brak szyby, uszkodzony profil…), kierownik widzi <b>pomarańczowy wiersz</b> z ⚠ za numerem (powód, kto, kiedy w podpowiedzi). Zdejmuje hala przyciskiem „załatwione" albo kierownik z menu ⋯. W legendzie nad tabelą można ją wyłączyć jak pilne i uwagi.</li>
          <li><b>Kolumna Akcje: 🖨️ ⚡ i menu „⋯"</b> (#132) — Historia, Zgłoś/zdejmij problem, Anuluj (na czerwono) albo Przywróć pod jednym przyciskiem. Mniej przypadkowych kliknięć, węższa kolumna; menu zamyka Esc, klik obok i przewinięcie tabeli.</li>
          <li><b>Dialog „Oznaczyć etap jako zrobiony?"</b> (#133) — dwa czytelne bloki: zlecenie + etap, klient + produkt; etykieta po lewej, pogrubiona wartość po prawej; szersze okno, długie nazwy etapów się nie łamią.</li>
          <li><b>Zgłoszenia: zrzuty ekranu i edycja</b> (#125) — w „Zgłoś uwagę" i w zakładce Zgłoszenia wklejasz zrzut <b>Ctrl+V</b>, przeciągasz plik albo wybierasz z dysku (do 6, po 10 MB); miniatura powiększa się po kliknięciu. Autor poprawia swoje zgłoszenie ołówkiem, dopóki nie jest „zrobione"; kierownik — każde.</li>
          <li><b>Etykiety → Dokumenty: „Podgląd"</b> (#127) przed Drukuj — PDF dokładnie tak, jak pójdzie na drukarkę; ZPL renderowany przez labelary.com (potrzebny internet). Oszczędza papier przy niepewnym dokumencie.</li>
          <li><b>Dymki RO i braków magazynowych</b> (#126) nie uciekają poza ekran: gdy pod ikoną nie ma miejsca, otwierają się nad nią, w poziomie trzymają się okna, przewinięcie tabeli je zamyka.</li>
          <li><b>Menu boczne na laptopach</b> (#135) — przy 1366×768 i mniejszych pasek jest węższy, a pozycje ciaśniejsze; nic nie wystaje poza ekran. Selecty w oknach druku etykiet wyglądają jak reszta pól (#129).</li>
        </ul>
        <h4>Zużycie magazynu pokazywało ułamek prawdy (beta.94)</h4>
        <ul>
          <li><b>Statystyki → Zużycie magazynu:</b> raport za 12 miesięcy ma ponad 1600 wierszy, a baza oddawała tylko pierwszy tysiąc — kategorie z końca listy (SKRZYDŁA, SZKLENIE, PROGI, ZAMKI I OKUCIA) były obcięte. Za listopad widać było 4 skrzydła zamiast 44. Teraz dane dociągane są w całości.</li>
          <li>Pod tabelą jest wiersz <b>RAZEM</b>: suma każdego miesiąca, SUMA i ŚREDNIA dla tego, co masz przefiltrowane (kategoria / szukajka), z liczbą komponentów.</li>
          <li>Ten sam limit zabezpieczony w <b>Alertach</b> magazynowych, Smart ROP i liście zleceń do weryfikacji, zanim urosną.</li>
        </ul>
        <h4>Magazyn → Stany: ostrzeżenia o brakach (beta.93)</h4>
        <ul>
          <li><b>Każda półka ma poziom</b> liczony w jednym miejscu (w bazie): <b>Krytyczny</b> (czerwony — dostępne poniżej zera i nic tego nie pokrywa), <b>Pokryty dostawą</b> (żółty — minus, ale otwarte zamówienia do dostawcy go pokrywają; przy statusie widać najbliższą dostawę), <b>Niski</b> (pomarańczowy — dostępne plus w drodze poniżej minimum), OK oraz Nieaktywny (zero, bez rezerwacji, bez minimum — szary). Tło wiersza i tekst w kolumnie STATUS mówią to samo.</li>
          <li><b>Pasek liczników nad tabelą to filtr</b> — klik w „Krytyczne", „Pokryte dostawą", „Niskie" (albo zbiorczo „Problemy") pokazuje tylko te wiersze, drugi klik zdejmuje filtr. Domyślnie tabela jest sortowana <b>„Najpierw braki"</b> (największy minus na górze), obok przełącznik „Alfabetycznie". Filtr, sortowanie i magazyn pamiętają się na tym komputerze.</li>
          <li><b>Minimum półki</b> — kierownik klika w komórkę MINIMUM, wpisuje liczbę, Enter (Esc cofa; puste = nie pilnujemy). Hurtowo: zaznacz wiersze checkboxami (widok jednego magazynu) i „Ustaw minimum" / „Wyczyść minimum". Gdy półka nie ma własnego minimum, obowiązuje Smart ROP (🤖) albo minimum z kartoteki komponentu („komp.").</li>
          <li>Nowa kolumna <b>DO ZAMÓWIENIA</b> = ile brakuje do minimum po uwzględnieniu tego, co w drodze, zaokrąglone w górę do minimum logistycznego komponentu (albo pełnej palety, gdy minimum nie wpisano). Przyciski <b>„Eksportuj braki (CSV)"</b> (gotowa lista do zamówienia) i <b>„Braki → lista zakupowa"</b> (wrzuca braki do Zamawiania).</li>
          <li>Gdy półka <b>przechodzi w stan krytyczny</b>, kierownicy magazynu i administratorzy dostają powiadomienie w dzwonku (raz na dobę na półkę); klik otwiera Stany. ⚠ przy nazwie jest tylko przy krytycznych; zgłoszenie zniszczenia to teraz przycisk <b>ZN</b> w kolumnie Akcje.</li>
        </ul>
        <h4>Legenda jako przełączniki (beta.92)</h4>
        <ul>
          <li><b>Klik w „pilne" lub „uwagi" w legendzie nad tabelą wyłącza dane podświetlenie</b> na tym komputerze (pozycja przekreślona, „wył."); drugi klik włącza z powrotem. Kto nie chce żółtych wierszy z uwagami, po prostu je gasi — reszta widzi po staremu.</li>
          <li>Kolumna Akcje w pilnym wierszu jest niebieska jak reszta wiersza (była różowa po beta.90).</li>
        </ul>
        <h4>Receptury magazynowe (beta.91)</h4>
        <ul>
          <li><b>Dopasowanie receptur nie patrzy już na polskie znaki</b> — wiersze z Excela mają kolory typu „DAB ZLOTY", słownik „DĄB ZŁOTY"; wcześniej takie zlecenia wisiały jako „częściowa receptura". Po przeliczeniu: Disting 45 → 3, STA 18 → 2 zleceń z częściową recepturą.</li>
          <li>Receptury <b>STA TITAN</b> (skrzydło i ościeżnica, 56 szt.) miały szerokość „80N TITAN" / „90E TITAN", której żadne zlecenie nie ma — przyjmują teraz także „80N" / „90E". Titany w STA mają komplet receptur.</li>
          <li>Co zostało do założenia ręcznie w Magazyn → Receptury, jest wypisane w Zgłoszeniach #65 / #66 / #64 (6 zleceń).</li>
        </ul>
        <h4>Po uwagach Mariusza do tabel (beta.90)</h4>
        <ul>
          <li><b>Kolumny PILNE nie ma</b> (#84) — pilne zlecenie poznasz po <b>niebieskim tle</b> wiersza, zlecenie z uwagami po <b>żółtym</b>; nad tabelą jest legenda. Kierownik oznacza pilne przyciskiem <b>⚡</b> w kolumnie Akcje.</li>
          <li><b>PANEL DEKORACYJNY i INTARSJA</b> to zawsze osobne kolumny (#85) — nie zwijają się już do jednej komórki pod SZKLENIEM.</li>
          <li><b>Bastion → „Tylko TITAN"</b> — przełącznik nad tabelą pokazuje same trójki Titan (modele G-: skrzydło z STA, ościeżnica z ST, okuwanie i montaż na Bastionie). Każdy Titan ma swój wiersz w Bastionie od momentu dodania w STA.</li>
          <li>Porządki w bazie (6.11): 21 zleceń starszych niż 90 dni bez wiersza w Excelu i bez żadnego etapu anulowano (powód w historii), 2 zamknięto datą wydania powiązanej nogi; rekord testowy ERP wyczyszczony.</li>
        </ul>
        <h4>Drobiazgi po testach (beta.89)</h4>
        <ul>
          <li><b>Synchronizacja z Excelem jest raz dziennie o 20:00</b> (tak ustawiony jest scenariusz Make), nie co godzinę — kafelek na Pulpicie ostrzega dopiero, gdy ostatni przebieg jest starszy niż dobę. Opisy w Pomocy i Weryfikacji poprawione.</li>
          <li><b>Plakietka RO</b> przy numerze zlecenia otwiera szczegóły (status, pełny numer, treść błędu, data) <b>klikiem</b> — tak samo jak dymek niedoboru magazynowego obok.</li>
          <li><b>Szablony etykiet:</b> warunek <code>{'{if pole}…{/if}'}</code> — fragment drukuje się tylko, gdy pole ma wartość (pusty wiersz znika zamiast „-"); <code>{'{if !pole}'}</code> odwrotnie.</li>
          <li>„Zgłoś zniszczenie": kontrolki w jednym stylu; ikona komentarza z wyraźniejszą ramką; nagłówki „NR ZLECENIA" bez kropki; dymek wstrzymanego etapu pokazuje tylko „Wstrzymane: powód".</li>
        </ul>
        <h4>Po testach z 6.11 (beta.87)</h4>
        <ul>
          <li><b>Weryfikacja → „Do wyjaśnienia po synchronizacji z Excelem"</b> — duplikaty, anulowane w arkuszu i inne rozbieżności z codziennej synchronizacji wydań (20:00); kafelek na Pulpicie z czasem ostatniej synchronizacji. Kafelki Pulpitu przewijają prosto do właściwej sekcji.</li>
          <li><b>Zmień hasło</b> — przycisk w prawym górnym rogu, każdy zmienia swoje.</li>
          <li>Program otwiera się tylko raz na komputerze (druga próba przywołuje istniejące okno); okno ma tytuł „KR Center Manager".</li>
          <li>Formularze pytają przed zamknięciem z niezapisanymi zmianami (wszystkie okna, nie tylko zlecenie).</li>
          <li>Moje stanowisko: <b>szukajka</b> i przycisk „✓ Oznacz E3 jako zrobione" zamiast mylącego „Zrobione".</li>
          <li>Dymek niedoboru magazynowego otwiera się klikiem, ma krzyżyk i przewija się; Wysyłka: plakietki „po terminie" / „blisko terminu" z podpisem; Audyt: „tylko zmienione pola"; Inwentaryzacja: podświetlony wiersz z kursorem; reklamacja: zlecenie wybierasz z wyszukiwaniem; Etykiety i druk: „Anuluj" i edycja dokumentu; kolumna UWAGI daje się poszerzyć.</li>
        </ul>
        <h4>Menu po porządkach (beta.86)</h4>
        <ul>
          <li><b>Zamówienia</b> — kategorie, a pod nimi <b>Weryfikacja</b> (duble, braki numerów, błędy ERP) i <b>Zakończone</b> (archiwum zrealizowanych zamówień).</li>
          <li><b>Produkcja</b> — Wysyłka, Etykiety i druk, ZKP AS 75EI.</li>
          <li><b>Magazyn</b> — pięć pozycji zamiast jednej z trzynastoma przyciskami: <b>Stany</b> (stany, rezerwacje, ruchy), <b>Komponenty</b> (kartoteka, receptury), <b>Dokumenty PZ / MM</b>, <b>Zamawianie</b> (sugestie, alerty, prognozy, zamówienia do dostawców), <b>Inwentaryzacja</b>.</li>
          <li><b>Analizy</b> — Statystyki (także „Zużycie magazynu") i Audyt.</li>
          <li><b>Ustawienia</b> — Konfiguracja (ze szablonami etykiet), Kontrahenci (klienci <i>i</i> dostawcy), Użytkownicy, Integracje (klucze API, Make / Optima).</li>
          <li>Plakietki liczą tylko to, co wymaga decyzji: Weryfikacja — rzeczy do sprawdzenia, Wysyłka — po terminie, Zamawianie — alerty braków.</li>
        </ul>
        <h4>Produkcja</h4>
        <ul>
          <li><b>Reklamacje na „Moje stanowisko"</b> (też na telefonie) — etapy otwartych reklamacji pojawiają się jako zadania z czerwoną plakietką REKLAMACJA. Części do napraw NIE schodzą same z magazynu — rozlicza je kierownik (Zniszczenia / ręczna WZ).</li>
          <li><b>E5 (pakowanie) odblokowane</b> dla zleceń łączonych i bez szkła — zadanie pojawia się, gdy zrobione są etapy, które faktycznie blokują.</li>
          <li><b>Cofnięcie etapu</b> przez kierownika od razu widać na innych stanowiskach (wcześniej wymagało odświeżenia).</li>
        </ul>
        <h4>Zamówienia</h4>
        <ul>
          <li><b>Plakietka ⚠️ przy numerze</b> = zamówienie z bota/Excela wymaga weryfikacji (duplikat treści, konflikt numeru). Szczegóły w zakładce Weryfikacja.</li>
          <li><b>Zaczep</b> to jedno pole: BRAK / MECHANICZNY / ELEKTROZACZEP — spięte z recepturami i DoP.</li>
          <li>Duże zakładki ładują się szybciej, a tabela dorysowuje wiersze w miarę przewijania.</li>
        </ul>
        <h4>Magazyn</h4>
        <ul>
          <li><b>Eksport stanu na wybrany dzień do CSV</b> (Magazyn → Stan).</li>
          <li>Zwroty ZWR: cofnięcie etapu/wydania umie oddać towar na półkę; ZD ma magazyn docelowy, a „w drodze" liczy się per magazyn.</li>
        </ul>
        <h4>Druk</h4>
        <ul>
          <li><b>Drukarka offline = czytelny błąd</b> zamiast fałszywego „wydrukowano" (zadanie nie wisi już po cichu w kolejce Windows).</li>
          <li>Druk zbiorczy ma przycisk <b>„Przerwij drukowanie"</b> i raportuje, ile poszło; zamknięcie okna nie ucina już partii bez słowa.</li>
        </ul>
        <h4>Konta i stabilność</h4>
        <ul>
          <li>Administrator może <b>dezaktywować konto</b> i <b>zresetować hasło</b> (Użytkownicy). Kierownik działu robi to samo dla <b>pracowników produkcji ze swoich kategorii</b> — i sam zakłada im konta.</li>
          <li>Po utracie i powrocie sieci program <b>sam odświeża dane</b>; awaria ekranu pokazuje komunikat z przyciskiem przeładowania zamiast białego okna.</li>
          <li>Program może wymagać minimalnej wersji — przy zbyt starej poprosi o aktualizację po zalogowaniu.</li>
        </ul>
      </>
    ),
  },
  // ── 1. Start ────────────────────────────────────────────────────────
  {
    id: 'start',
    title: '🏁 Pierwsze kroki',
    keywords: 'logowanie login hasło start interfejs panel boczny sidebar aktualizacja update wersja',
    body: (
      <>
        <p>
          <b>KR Center Manager Produkcji</b> to system zarządzania zleceniami, produkcją,
          magazynem i wysyłką. Dane są wspólne dla całej firmy i synchronizują się na żywo —
          to, co oznaczysz, natychmiast widzą inni.
        </p>
        <h4>Logowanie</h4>
        <ul>
          <li>Logujesz się <b>nazwą użytkownika</b> (loginem) i hasłem nadanym przez administratora.</li>
          <li>Po dłuższej bezczynności (ok. 1 h) program wylogowuje automatycznie.</li>
        </ul>
        <h4>Interfejs</h4>
        <ul>
          <li><b>Panel boczny (lewa strona)</b> — nawigacja po zakładkach. Zakładki pogrupowane: Zamówienia, Produkcja, Magazyn, Administracja. Widzisz tylko to, do czego masz uprawnienia.</li>
          <li><b>Zwijanie panelu</b> — strzałka ‹ › u góry panelu zwija go do paska ikon (ustawienie się zapamiętuje).</li>
          <li><b>Dzwonek 🔔</b> — powiadomienia (np. nowe zamówienia z konfiguratora do weryfikacji).</li>
          <li><b>Zgłoś uwagę</b> — pływający przycisk w prawym dolnym rogu; każdy może zgłosić błąd lub pomysł.</li>
        </ul>
        <h4>Aktualizacje</h4>
        <ul>
          <li>Program sam sprawdza nową wersję po zalogowaniu. Gdy jest dostępna — pobierz i pozwól na restart (trwa chwilę).</li>
          <li>Jeśli aktualizacja jest wymagana, program poprosi o nią przed zalogowaniem.</li>
          <li>Aktualną wersję widać na dole panelu bocznego oraz w oknie „O programie".</li>
        </ul>
      </>
    ),
  },
  // ── 2. Role ─────────────────────────────────────────────────────────
  {
    id: 'role',
    title: '👤 Role i uprawnienia',
    keywords: 'rola uprawnienia kierownik admin pracownik magazynier obsługa klienta kategorie dostęp ceny',
    body: (
      <>
        <p>Każde konto ma <b>rolę</b>, która decyduje co widzisz i co możesz zrobić:</p>
        <ul>
          <li><b>Administrator</b> — pełny dostęp, w tym grupa Ustawienia (Konfiguracja, Kontrahenci, Użytkownicy, Integracje).</li>
          <li><b>Kierownik firmowy / produkcji / magazynu</b> — pełne zarządzanie zleceniami, magazynem, wysyłką i statystykami (bez panelu administracyjnego).</li>
          <li><b>Kierownik działu</b> — jak kierownik, ale <b>zawężony do przypisanych kategorii</b> (np. tylko STA + Disting).</li>
          <li><b>Pracownik produkcji</b> — widzi przypisane kategorie, oznacza <b>tylko swoje przypisane etapy</b> (w „Moje stanowisko" i w tabelach), dodaje komentarze.</li>
          <li><b>Magazynier</b> — podgląd zleceń + wysyłka + ruchy magazynowe (PZ/MM); bez edycji komponentów i receptur.</li>
          <li><b>Obsługa klienta</b> — podgląd wszystkich zleceń + komentarze + druk etykiet; bez edycji.</li>
        </ul>
        <p>
          <b>Ceny</b> (wartość konfiguratora) widzą tylko kierownicy i administrator.
          Tworzenie, edycja, anulowanie zleceń, wydania i odbiory — tylko kierownicy.
        </p>
        <p className="help-note">
          Jeżeli nie widzisz jakiejś zakładki albo nie możesz czegoś kliknąć — to niemal zawsze kwestia
          roli. Zgłoś się do administratora.
        </p>
      </>
    ),
  },
  // ── 3. Zamówienia — podstawy ───────────────────────────────────────
  {
    id: 'zamowienia',
    title: '🚪 Zamówienia — obsługa codzienna',
    keywords: 'zamówienie zlecenie dodawanie edycja etap inicjały pilne wydanie anulowanie komentarze wyszukiwanie filtr duplikat historia',
    body: (
      <>
        <p>
          Każda kategoria produkcyjna ma swoją zakładkę: <b>STA, Disting, ST, Techniczne, Bastion,
          Drzwi wewnętrzne</b>. Tabela pokazuje aktywne zlecenia (wydane trafiają na dół z oznaczeniem
          ZREALIZOWANE, a po archiwizacji do zakładki Zakończone).
        </p>
        <h4>Praca ze zleceniem</h4>
        <ul>
          <li><b>Nowe zamówienie</b> — przycisk nad tabelą; numer zlecenia nadaje się automatycznie (kolejny w kategorii). Pola słownikowe (system, kolory, okucia…) podpowiadają wartości z Konfiguracji.</li>
          <li><b>Edycja</b> — kliknięcie wiersza otwiera okno zlecenia (kierownik). W oknie są też przyciski <b>🏷️ Drukuj etykietę</b> i <b>📄 Drukuj DoP</b>.</li>
          <li><b>Duplikuj</b> — tworzy kopię zlecenia z nowym numerem (przy powtarzalnych zamówieniach).</li>
          <li><b>Historia</b> — ikona zegara w Akcjach pokazuje kto i co zmieniał.</li>
          <li><b>Anuluj / Przywróć</b> — w kolumnie Akcje (kierownik). Anulowanie zwraca komponenty na magazyn.</li>
        </ul>
        <h4>Etapy produkcji</h4>
        <ul>
          <li>Kliknięcie <b>pustej</b> komórki etapu wstawia <b>Twoje inicjały</b> — „zrobione, przeze mnie".</li>
          <li>Kliknięcie <b>wypełnionej</b> komórki = cofnięcie etapu (z potwierdzeniem; pracownik produkcji cofa tylko <b>swoje</b> inicjały na przypisanych etapach — cudze cofa kierownik).</li>
          <li>Etap uznaje się za wykonany, gdy komórka jest <b>niepusta</b> — dlatego widać inicjały wykonawcy, nie „ptaszek".</li>
        </ul>
        <h4>Pilne i wydanie</h4>
        <ul>
          <li><b>PILNE ⚡</b> — przycisk ⚡ w kolumnie Akcje (kierownik) podbija zlecenie na górę listy; pilny wiersz ma niebieskie tło. Osobnej kolumny PILNE już nie ma — legenda kolorów stoi nad tabelą.</li>
          <li><b>WYDANIE</b> — klik wstawia dzisiejszą datę = zlecenie zrealizowane (kierownik). Wydanie jest <b>niezależne per kategoria</b> — np. w Titanie STA wydaje skrzydło, ST ościeżnicę, Bastion komplet.</li>
        </ul>
        <h4>Komentarze i wyszukiwanie</h4>
        <ul>
          <li><b>💬 przy numerze</b> — komentarze do zlecenia; <code>@imię</code> oznacza osobę (dostanie powiadomienie). Licznik pokazuje nieprzeczytane.</li>
          <li><b>Ctrl+K</b> — globalna wyszukiwarka zleceń (numer, firma, model) ze wszystkich kategorii.</li>
          <li><b>Filtry nad tabelą</b> — dzień produkcji, szukanie tekstowe, filtr źródła (ręczne / konfigurator).</li>
        </ul>
        <h4>Kolory wierszy</h4>
        <ul>
          <li><b>Niebieskawy</b> — pilne. <b>Żółtawy</b> — zlecenie ma wpis w UWAGACH. <b>Zielonkawy / ZREALIZOWANE</b> — wydane. <b>Wyszarzony</b> — anulowane. Legenda z tymi kolorami jest nad każdą tabelą zleceń.</li>
          <li><b>Nie chcesz któregoś koloru?</b> Kliknij „pilne" albo „uwagi" w legendzie — podświetlenie gaśnie (pozycja przekreślona, „wył."), drugi klik je przywraca. Ustawienie pamięta ten komputer, każdy ma swoje.</li>
          <li>Plakietka <b>BOT</b> — zlecenie przyszło automatycznie (konfigurator / Excel).</li>
        </ul>
      </>
    ),
  },
  // ── 4. Zamówienia łączone ───────────────────────────────────────────
  {
    id: 'laczone',
    title: '🔗 Zamówienia łączone: Disting Plus i Titan',
    keywords: 'disting plus titan core guard bastion łączone para mirror ość skrz powiązane linked',
    body: (
      <>
        <h4>Disting Plus (para STA ↔ Disting)</h4>
        <ul>
          <li>Zlecenie z systemem <b>DISTING PLUS</b> automatycznie tworzy <b>parę</b>: rekord w Disting + rekord w STA (formularz i API).</li>
          <li><b>Disting</b> robi ościeżnicę (E1, E2.1, E2.2, E5-pakowanie), <b>STA</b> robi skrzydło (E3, E4).</li>
          <li>Etapy się <b>mirrorują</b> — oznaczenie po jednej stronie widać po drugiej (kolumny tylko do odczytu).</li>
          <li>W STA kolumna <b>OŚĆ.</b> pokazuje pakowanie ościeżnicy z Disting, a <b>ODBIÓR</b> — ręczne potwierdzenie odbioru ościeżnicy (kierownik).</li>
          <li><b>Edycja synchronizuje się w obie strony</b> — zmiana koloru/wymiaru po stronie STA aktualizuje rekord Disting i odwrotnie (pola produktowe; etapy i wydania pozostają osobne).</li>
        </ul>
        <h4>Titan (trójka STA + ST + Bastion)</h4>
        <ul>
          <li>Zlecenie STA z systemem <b>CORE / GUARD RC2 / GUARD RC3 (w tym EI 30)</b> tworzy <b>trzy</b> powiązane rekordy.</li>
          <li><b>STA</b> — frezowanie i wydanie skrzydła (aktywne E3 i E5; reszta zablokowana).</li>
          <li><b>ST</b> — wyłącznie ościeżnica (etap OŚCIEŻNICA) + wydanie.</li>
          <li><b>Bastion</b> — stacja końcowa: <b>okuwanie → montaż → pakowanie</b>. Chipy <b>OŚC</b> / <b>SKRZ</b> przy numerze pokazują, czy ościeżnica (z ST) i skrzydło (ze STA) zostały już wydane — czyli czy można montować.</li>
          <li>Każdy dział oznacza tylko swoje etapy i wydaje niezależnie.</li>
        </ul>
      </>
    ),
  },
  // ── 5. Kategorie specyfika ─────────────────────────────────────────
  {
    id: 'kategorie',
    title: '🗂️ Specyfika kategorii',
    keywords: 'sta disting st techniczne bastion drzwi wewnętrzne panel boczny górny dostawka naświetle poszerzenie kolekcja ościeżnica regulowana',
    body: (
      <>
        <ul>
          <li><b>STA / Disting</b> — drzwi zewnętrzne: naświetla górne, dostawki boczne A/B (strona klamkowa/przeciwklamkowa) ze szkleniem, poszerzenia z automatycznym wyliczaniem wymiarów profili.</li>
          <li><b>ST</b> — drzwi stalowe; etapy zależne od typu (standard / Titan); kolumna PRÓG pokazuje kolor progu.</li>
          <li><b>Techniczne</b> — uproszczony obieg, bez etapów produkcyjnych w tabeli.</li>
          <li><b>Bastion</b> — kolekcja/system, typ ościeżnicy (drewniana/stalowa, regulowana z zakresem), <b>panel boczny (klamkowy / przeciwklamkowy) i panel górny</b> — płaskie elementy wykończeniowe doklejane do ościeżnicy (nie wliczają się do szerokości montażowej), automatyczna liczba etykiet (mnożnik ościeżnicy × ilość), PROMO, priorytet produkcji ościeżnic regulowanych.</li>
          <li><b>Drzwi wewnętrzne</b> — zlecenia oparte o pozycje magazynowe (konkretne drzwi z kartoteki); osobny widok szczegółów i BOM.</li>
        </ul>
      </>
    ),
  },
  // ── 6. Moje stanowisko ─────────────────────────────────────────────
  {
    id: 'stanowisko',
    title: '✅ Moje stanowisko',
    keywords: 'moje stanowisko zadania pracownik etap przypisane gotowe do pracy czeka',
    body: (
      <>
        <p>
          Widok dla pracownika produkcji: lista zadań wynikających z <b>przypisanych Ci etapów</b>
          (przypisuje kierownik w panelu Użytkownicy → „Etapy produkcji").
        </p>
        <p>
          <b>Stany specjalne etapu</b> (ustawia kierownik, prawy klik na komórce etapu w tabeli): <b>—</b> szara kreska =
          „nie dotyczy" (etap w tym zleceniu niepotrzebny, liczy się jako zrobiony, nikt go nie robi, a rezerwacja części na ten etap wraca na magazyn; „Wznów" ją przywraca);{' '}
          <b>⏸</b> pomarańczowa pauza = „wstrzymane" (czekamy, np. na klienta albo materiał — na stanowisku zamiast przycisku
          widać „Wstrzymane: powód", NASTĘPNE to zlecenie omija). Zdejmuje je kierownik tym samym menu („Wznów").
        </p>
        <p><b>Krok po kroku (ściąga przy stanowisku):</b></p>
        <ol>
          <li>Na górze widać, <b>kto jest zalogowany</b>. To nie Ty? Kliknij „To nie ja — zmień osobę" i zaloguj się na siebie.</li>
          <li>Pierwsze gotowe zlecenie w kolejce ma plakietkę <b>NASTĘPNE</b>. Pilne i „na dziś" są zawsze na górze.</li>
          <li>Kliknij wiersz, żeby zobaczyć <b>wymiary, kolory, szklenia</b> dla Twojego etapu.</li>
          <li>Po robocie kliknij zielony przycisk <b>✓ Oznacz E3 jako zrobione</b> (nazwa etapu jest na przycisku), a potem <b>kafelek ze SWOIMI inicjałami</b>. Zapis widać od razu u kierownika.</li>
          <li>Dużo zadań? W pasku liczników jest <b>szukajka</b> — wpisz numer zlecenia, firmę albo model.</li>
          <li>Pomyłka? Na górze przez 5 minut jest pasek <b>Cofnij</b>. Później cofniesz w tabeli zlecenia (klik w zieloną komórkę) — ale tylko <b>swoje</b> inicjały; cudze cofa kierownik.</li>
          <li>Okno „W magazynie brakuje części" — jeśli etap jest zrobiony, kliknij <b>Zrobione mimo braku</b>. Magazyn dostanie informację, nic nie psujesz.</li>
          <li>Napis „⏳ Czeka na E1" = jeszcze nie Twoja kolej; zadanie samo zmieni się na gotowe, gdy kolega skończy.</li>
          <li>Za małe litery? Przyciski <b>A− / A+</b> w prawym górnym rogu (albo Ctrl + / Ctrl −) — ustawienie zostaje na tym komputerze.</li>
        </ol>
        <ul>
          <li>W tabelach zleceń komórki <b>nie Twoich</b> etapów są wykropkowane i nie reagują na klik; Twoje etapy stoją zaraz za FIRMĄ.</li>
          <li>Gdy ktoś oznaczył ten sam etap chwilę przed Tobą, program powie „Ten etap jest już oznaczony (XX)" — nic nie nadpisujesz.</li>
          <li>Program sam się wyloguje po godzinie bez klikania (wcześniej zapyta „Jesteś tam jeszcze?").</li>
        </ul>
      </>
    ),
  },
  // ── 7. Wysyłka ─────────────────────────────────────────────────────
  {
    id: 'wysylka',
    title: '🚛 Wysyłka',
    keywords: 'wysyłka postęp fakturowanie trasa dzień zaległe przeterminowane',
    body: (
      <>
        <p>Zlecenia w drodze do wydania — widok dla kierowników i magazynu.</p>
        <ul>
          <li><b>Pasek postępu</b> — ile etapów ukończonych; najedź, by zobaczyć które.</li>
          <li><b>Gotowe do fakturowania</b> — checkbox; program podpowiada, gdy 100% etapów lub jest data wydania.</li>
          <li>Sortowanie wg <b>dnia trasy</b> kontrahenta (ustawianego w Kontrahentach).</li>
          <li><b>Zaległe</b> — zlecenia po terminie są oznaczone; licznik zaległych widać przy zakładce Wysyłka w panelu bocznym.</li>
        </ul>
      </>
    ),
  },
  // ── 8. Etykiety i druk ─────────────────────────────────────────────
  {
    id: 'druk',
    title: '🖨️ Etykiety i druk (QR, DoP/DWU)',
    keywords: 'etykieta drukowanie qr zebra dop dwu deklaracja zpl szablon drukarka komplet zaznaczanie checkbox pakiet',
    body: (
      <>
        <p>Wszystko drukuje się na <b>drukarkach z Windows</b> (tych samych, co w Ctrl+P) — także Zebry.</p>
        <h4>Dwa rodzaje wydruku</h4>
        <ul>
          <li><b>Etykieta zlecenia (QR)</b> — generowana z szablonu HTML: dane zlecenia + kod QR z numerem ID. Szablon dobiera się wg kategorii.</li>
          <li><b>Dokumenty DoP / DWU (ZPL)</b> — gotowe pliki deklaracji drukowane surowo na Zebrę. Program <b>sam dobiera właściwą deklarację</b> do zlecenia wg: kategorii + systemu + realizatora (Center/Profil/WZ) + szklone/pełne + rodzaju ościeżnicy (Bastion: stalowa/drewniana).</li>
        </ul>
        <h4>Druk pojedynczego zlecenia</h4>
        <p>Otwórz zlecenie → <b>🏷️ Drukuj etykietę</b> (podgląd + liczba kopii) lub <b>📄 Drukuj DoP</b> (dobrana deklaracja).</p>
        <h4>Druk masowy — „Drukuj komplet"</h4>
        <ol>
          <li>W tabeli zaznacz zlecenia <b>checkboxami przy numerze</b> (w ramach jednej kategorii — zmiana zakładki czyści zaznaczenie).</li>
          <li>W prawym górnym rogu pojawi się <b>„Drukuj komplet (N)"</b>.</li>
          <li>W oknie: wybierz drukarkę, zaznacz co drukować (☑ etykieta QR, ☑ DoP), ustaw <b>liczbę etykiet per zlecenie</b> — np. drzwi z naświetlem i dostawką = 3 szt. Znaczniki <i>dostawka</i>/<i>naświetle</i> przy każdym wierszu podpowiadają ile dać.</li>
          <li>Program drukuje po kolei z paskiem postępu i raportem (ile OK, ile pominięto).</li>
        </ol>
        <h4>Konfiguracja (kierownik)</h4>
        <ul>
          <li><b>Ustawienia → Konfiguracja → Szablony etykiet</b> — szablony HTML per kategoria; edytor ma instrukcję, listę pól (np. <code>{'{{nr_zlecenia}}'}</code>, <code>{'{{qr}}'}</code>, <code>{'{{panel_gorny}}'}</code>), warunki <code>{'{if pole}…{/if}'}</code> (fragment tylko, gdy pole ma wartość) i podgląd w rzeczywistym rozmiarze. ⭐ = szablon domyślny.</li>
          <li><b>Produkcja → Etykiety i druk</b> — wgrywasz pliki ZPL (deklaracje) i przypisujesz cechy doboru (system, realizator, szklone/pełne, ościeżnica). Puste pole = „dowolne". „Drukuj paczkę" drukuje wszystkie dokumenty kategorii naraz.</li>
          <li>Pliki <code>.nlbl</code> (Zebra Designer) trzeba najpierw <b>wyeksportować do ZPL</b> w Zebra Designerze — sam projekt .nlbl nie nadaje się do importu.</li>
        </ul>
      </>
    ),
  },
  // ── 9. Magazyn ─────────────────────────────────────────────────────
  {
    id: 'magazyn',
    title: '📦 Magazyn',
    keywords: 'magazyn stany komponenty pz mm przyjęcie przesunięcie receptury zamawianie rop inwentaryzacja alerty dostawcy',
    body: (
      <>
        <p>Grupa <b>Magazyn</b> w menu ma pięć pozycji, każda z krótkim paskiem podzakładek:</p>
        <ul>
          <li><b>Stany</b> — <i>Stany</i>: ilości komponentów w podziale na magazyny (Bukowa, Marklowicka, Wewnętrzne #1/#2) z poziomem każdej półki (Krytyczny / Pokryty dostawą / Niski / OK — tło wiersza, liczniki nad tabelą jako filtr, sortowanie „Najpierw braki"), minimum półki do ustawienia przez kierownika (klik w MINIMUM lub hurtowo), kolumna DO ZAMÓWIENIA, eksport braków do CSV i na listę zakupową; <i>Rezerwacje</i>: co trzymają otwarte zlecenia; <i>Ruchy</i>: historia wszystkich operacji.</li>
          <li><b>Komponenty</b> — <i>Komponenty</i>: kartoteka surowców i drzwi (przy tworzeniu wskazujesz magazyny, kod generuje się automatycznie); <i>Receptury</i>: co schodzi ze stanu przy realizacji zlecenia (dobór po kategorii/systemie/modelu/kolorze), zejście automatyczne przy dodaniu zlecenia, anulowanie zwraca komponenty.</li>
          <li><b>Dokumenty PZ / MM</b> — <i>Przyjęcia (PZ)</i>: przyjęcie towaru, filtry po dostawcy i kategorii, jednostki sztukowe tylko całkowite; <i>Przesunięcia (MM)</i>: ruchy między magazynami.</li>
          <li><b>Zamawianie</b> — <i>Zamawianie</i>: sugestie zakupów (ROP z prognozą sezonową) i lista zakupowa; <i>Alerty</i>: braki i przewidywane wyczerpanie (licznik przy tej pozycji w menu); <i>Prognozy</i>; <i>Zamówienia</i>: zamówienia do dostawców z wydrukiem PDF.</li>
          <li><b>Inwentaryzacja</b> — remanent: eksport arkusza PDF do liczenia, potem wprowadzenie stanów rzeczywistych.</li>
        </ul>
        <p className="help-note">Raport „Zużycie magazynu" (miesięczne zejścia per komponent) jest w Analizy → Statystyki. Dostawców dopisujesz w Ustawienia → Kontrahenci → Dostawcy.</p>
      </>
    ),
  },
  // ── 10. Automaty ───────────────────────────────────────────────────
  {
    id: 'automaty',
    title: '🤖 Zamówienia automatyczne (konfigurator / Excel)',
    keywords: 'bot konfigurator excel api weryfikacja needs review kontrahent alias dopasowanie wpisał źródło',
    body: (
      <>
        <p>Zlecenia wpadają do programu automatycznie z dwóch źródeł:</p>
        <ul>
          <li><b>Konfigurator (BOT)</b> — zamówienia klientów z konfiguratora online.</li>
          <li><b>Excel</b> — zamówienia wprowadzane formularzem do arkusza (ręczne i z formularza bota) — z prawdziwymi numerami zleceń i kolumną „Wpisał" (autor trafia do kolumny WPISAŁ).</li>
        </ul>
        <h4>Weryfikacja</h4>
        <ul>
          <li>Zlecenie z brakami (brak modelu, firmy, nieznana kategoria) dostaje flagę i trafia do zakładki <b>Weryfikacja</b> — kierownik uzupełnia dane i zatwierdza.</li>
          <li>Automaty same tworzą pary Disting Plus i trójki Titan — tak jak formularz.</li>
          <li><b>Optima (RO)</b>: zamówienia z konfiguratora zakłada w Optimie automat. Przy numerze zlecenia widać zieloną plakietkę z numerem RO albo czerwoną <b>Błąd ERP</b> (najedź — zobaczysz powód, np. brak towaru w Optimie). Lista błędów jest w Weryfikacji w sekcji „Błędy ERP (Optima)", a kierownicy dostają powiadomienie w dzwonku. Po usunięciu przyczyny (np. dodaniu towaru w Optimie) kierownik klika <b>„Ponów wysyłkę do Optimy"</b> w oknie zlecenia albo na liście błędów — Make zakłada RO jeszcze raz i status sam się odświeży. Adres webhooka Make ustawia administrator w Ustawienia → <b>Integracje</b>. Numer RO działa też w wyszukiwarce zleceń (wpisz np. „231/11").</li>
          <li><b>Synchronizacja wydań z Excela</b>: codziennie o 20:00 automat czyta arkusze „Zamówienia *.xlsm" i zamyka zlecenia wydane w Excelu (zwalnia też ich rezerwacje). Czego nie rozstrzygnął, ląduje w Weryfikacji w sekcji <b>„Do wyjaśnienia po synchronizacji z Excelem"</b>: <i>Duplikaty</i> (jeden wiersz arkusza → kilka zleceń; zostaje zlecenie z konfiguratora, kopię z Excela anulujesz przyciskiem), <i>Anulowane w Excelu</i> (w arkuszu ANULOWANE, w programie jeszcze otwarte), <i>Inne</i> (np. WSTRZYMANE). Kafelek na Pulpicie pokazuje godzinę ostatniej synchronizacji i ostrzega, gdy jest starsza niż dobę.</li>
        </ul>
        <h4>Dopasowanie kontrahenta</h4>
        <ul>
          <li>Gdy nazwa firmy z automatu nie pasuje do bazy kontrahentów, przy edycji pojawia się żółte ostrzeżenie z podpowiedzią <b>„Dopasuj do: …"</b> oraz <b>ręcznym wyborem z listy</b>.</li>
          <li>Dopasowanie <b>zapamiętuje alias</b> — kolejne zamówienia z tą nazwą podmieniają się już same.</li>
          <li>Można też od razu <b>utworzyć nowego kontrahenta</b> z tej nazwy.</li>
        </ul>
      </>
    ),
  },
  // ── 11. Reklamacje ────────────────────────────────────────────────
  {
    id: 'reklamacje',
    title: '🔁 Reklamacje',
    keywords: 'reklamacja zwrot naprawa archiwum',
    body: (
      <>
        <ul>
          <li>Zakładka <b>Reklamacje</b> (podzakładka w kategorii) — zgłoszenia napraw/ponownej produkcji.</li>
          <li>Reklamację tworzy się z ręki albo <b>z archiwalnego zlecenia</b> (wyszukujesz stary numer — dane się kopiują).</li>
          <li>Reklamacje mają własne etapy produkcji, oznaczane tak samo jak w zleceniach.</li>
        </ul>
      </>
    ),
  },
  // ── 12. Statystyki ────────────────────────────────────────────────
  {
    id: 'statystyki',
    title: '📊 Statystyki i Pulpit',
    keywords: 'statystyki wykresy pulpit dashboard produktywność czasy realizacji lead time',
    body: (
      <>
        <ul>
          <li><b>Pulpit</b> — szybki przegląd dnia dla kierownika: liczby, zaległe, skróty.</li>
          <li><b>Statystyki</b> (Analizy) — produkcja wg kategorii (wykresy statusów, trendy po systemach / modelach / kolorach, braki materiałowe z czasem realizacji), reklamacje (co i dlaczego reklamowane), firmy (jedna firma pod lupą: zlecenia, reklamacje, czas realizacji, co zamawia), drzwi wewnętrzne (grupy modelowe, kolory i rozmiary, trend spada / rośnie, braki, na które czeka klient), produktywność, czasy realizacji, zużycie magazynu (miesięczne zejścia per komponent).</li>
          <li><b>Audyt</b> (Analizy) — pełna historia zmian: kto, kiedy, co zmienił.</li>
          <li>Wykres statusu pokazuje sumę drzwi w środku, procenty na wycinkach i legendę z wartościami.</li>
        </ul>
      </>
    ),
  },
  // ── 13. Administracja ─────────────────────────────────────────────
  {
    id: 'admin',
    title: '⚙️ Ustawienia (admin/kierownik)',
    keywords: 'ustawienia administracja konfiguracja słowniki wykluczenia użytkownicy klucze api integracje make optima webhook kontrahenci dostawcy szablony etykiet czasy realizacji dane firmy',
    body: (
      <>
        <ul>
          <li><b>Konfiguracja</b> — słowniki pól formularzy (systemy, modele, kolory, okucia…), wykluczenia niedozwolonych kombinacji, słownik wymiarów, naddatki szyb, dane firmy, terminy realizacji (progi ostrzeżeń), reguły Bastion, szablony etykiet HTML.</li>
          <li><b>Kontrahenci</b> — <i>Klienci</i>: dni produkcji/tras, dane logistyczne, scalanie aliasów nazw; <i>Dostawcy</i>: firmy, od których kupuje magazyn (zamówienia do dostawców, ZKP).</li>
          <li><b>Użytkownicy</b> — konta, role, przypisane kategorie, przypisane etapy pracowników („Etapy produkcji"). Hasła nadaje się przy tworzeniu konta. Kierownik działu widzi tu tylko pracowników produkcji ze swoich kategorii: zakłada konta, resetuje hasła, przypisuje etapy, dezaktywuje; ról nie zmienia i kont nie usuwa.</li>
          <li><b>Integracje</b> — <i>Klucze API</i> dla konfiguratora i arkusza Excel (generowanie, dezaktywacja, statystyki użycia i limity) oraz <i>Make / Optima</i>: adres webhooka do „Ponów wysyłkę do Optimy" (RO).</li>
        </ul>
        <p className="help-note">Zakończone (archiwum zrealizowanych zleceń) są w grupie Zamówienia, Audyt w Analizach.</p>
      </>
    ),
  },
  // ── 14. Mobilna ───────────────────────────────────────────────────
  {
    id: 'mobile',
    title: '📱 Aplikacja mobilna',
    keywords: 'mobile telefon pakowanie zdjęcia stanowisko wysyłka przeglądarka',
    body: (
      <>
        <p>Wersja mobilna (w przeglądarce telefonu) dla produkcji i pakowania:</p>
        <ul>
          <li><b>Zamówienia</b> — podgląd i wyszukiwanie zleceń.</li>
          <li><b>Moje stanowisko</b> — oznaczanie swoich etapów z telefonu.</li>
          <li><b>Pakowanie</b> — wyszukanie zlecenia i <b>dodanie zdjęć</b> spakowanych drzwi (dokumentacja wysyłki).</li>
          <li><b>Wysyłka</b> — podgląd gotowych do wydania.</li>
        </ul>
        <p className="help-note">W planach: skaner kodów QR z etykiet (po wdrożeniu drukowanych etykiet w firmie).</p>
      </>
    ),
  },
  // ── 15. Skróty i triki ────────────────────────────────────────────
  {
    id: 'skroty',
    title: '⌨️ Skróty i triki',
    keywords: 'skróty klawisze ctrl k enter tips triki',
    body: (
      <>
        <ul>
          <li><b>Ctrl+K</b> — globalna wyszukiwarka zleceń.</li>
          <li><b>Enter</b> w polach formularza — zapis (tam, gdzie to bezpieczne).</li>
          <li><b>Esc</b> — zamyka okna dialogowe.</li>
          <li>Najechanie na komórkę tabeli pokazuje <b>pełną treść</b> (dymek) — przydatne przy uciętych tekstach.</li>
          <li>Kliknięcie numeru w kolumnach „NR W ARKUSZU…" <b>przenosi do powiązanego zlecenia</b> w drugiej kategorii.</li>
          <li>Panel boczny zwiniesz strzałką — więcej miejsca na tabelę.</li>
        </ul>
      </>
    ),
  },
  // ── 16. FAQ ───────────────────────────────────────────────────────
  {
    id: 'faq',
    title: '❓ Częste problemy (FAQ)',
    keywords: 'faq problem nie działa nie widzę zniknęło drukarka błąd pomoc',
    body: (
      <>
        <ul>
          <li>
            <b>Nie widzę zakładki / przycisku.</b> — To kwestia roli konta. Poproś administratora
            o nadanie uprawnień (sekcja „Role i uprawnienia").
          </li>
          <li>
            <b>Zamówienie „zniknęło" z listy.</b> — Najczęściej zostało <b>wydane</b> (ma datę w WYDANIE)
            albo anulowane. Sprawdź na dole tabeli (ZREALIZOWANE), w zakładce Zakończone albo przez Ctrl+K.
          </li>
          <li>
            <b>Nie mogę oznaczyć etapu.</b> — Pracownik produkcji oznacza tylko <b>przypisane mu</b> etapy;
            w zleceniach Titan część etapów jest celowo zablokowana (robi je inny dział).
          </li>
          <li>
            <b>Drukarka nie drukuje.</b> — Sprawdź, czy drukarka jest widoczna w Windows (Ustawienia →
            Drukarki) i włączona. Etykiety QR i DoP drukują się przez drukarki systemowe — jeśli działa
            wydruk testowy z Windows, zadziała i z programu.
          </li>
          <li>
            <b>Zamówienie z konfiguratora ma złą firmę.</b> — Otwórz zlecenie i użyj żółtej belki
            „Dopasuj" (auto lub ręcznie z listy). Program zapamięta wybór na przyszłość.
          </li>
          <li>
            <b>Program nie odpowiada / dziwne dane.</b> — Zamknij i uruchom ponownie; przy starcie
            zaciągnie świeże dane. Jeśli problem wraca — zgłoś przyciskiem „Zgłoś uwagę" (opisz co
            robiłeś krok po kroku).
          </li>
          <li>
            <b>Znalazłem błąd / mam pomysł.</b> — Pływający przycisk <b>„Zgłoś uwagę"</b> (prawy dolny róg)
            albo zakładka <b>Zgłoszenia</b>. Zgłoszenia przeglądamy na bieżąco.
          </li>
        </ul>
      </>
    ),
  },
]

// Dokumentacja techniczna (docs/ARCHITEKTURA.md) renderowana z markdown —
// widoczna tylko dla kierowników/admina. Treść statyczna z repo (bezpieczna).
const TECH_SECTION: Section = {
  id: 'architektura',
  title: '🛠️ Dokumentacja techniczna (administrator)',
  keywords:
    'architektura techniczna admin deploy edge functions rpc migracje sql runbook wdrażanie modele systemy słowniki backup release',
  body: (
    <div
      className="help-md"
      dangerouslySetInnerHTML={{ __html: marked.parse(architekturaMd, { async: false }) }}
    />
  ),
}

type HelpViewProps = { isManager?: boolean }

export default function HelpView({ isManager = false }: HelpViewProps) {
  const [query, setQuery] = useState('')
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set([SECTIONS[0].id]))
  const contentRef = useRef<HTMLDivElement | null>(null)

  const allSections = useMemo(
    () => (isManager ? [...SECTIONS, TECH_SECTION] : SECTIONS),
    [isManager],
  )
  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      q
        ? allSections.filter((s) => s.title.toLowerCase().includes(q) || s.keywords.includes(q))
        : allSections,
    [q, allSections],
  )

  const goTo = (id: string) => {
    setOpenIds((prev) => new Set(prev).add(id))
    // scroll po otwarciu sekcji
    requestAnimationFrame(() => {
      contentRef.current
        ?.querySelector(`[data-help-id="${id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const toggle = (id: string, open: boolean) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <div className="help-view help-view--pro">
      <div className="help-intro">
        <h2>Instrukcja obsługi — KR Center Manager</h2>
        <p>
          Pełny przewodnik po programie. Wybierz temat z listy albo użyj wyszukiwarki.
          Wersja aplikacji: <b>{packageJson.version}</b>.
          {isManager && (
            <>
              {' '}
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                title="Otwiera katalog z plikiem errors.log — wszystkie błędy aplikacji z tego komputera (przydatne przy zgłaszaniu problemów)"
                onClick={() => {
                  const ipc = (window as Window & { ipcRenderer?: { invoke: (c: string) => Promise<unknown> } }).ipcRenderer
                  void ipc?.invoke('log:reveal')
                }}
              >
                🩺 Pokaż log błędów
              </button>
            </>
          )}
        </p>
        <label className="help-search">
          <Search size={15} />
          <input
            type="text"
            placeholder="Szukaj w instrukcji… (np. etykieta, wydanie, PZ)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="help-layout">
        <nav className="help-nav" aria-label="Spis treści">
          {visible.map((s) => (
            <button key={s.id} type="button" className="help-nav-item" onClick={() => goTo(s.id)}>
              {s.title}
            </button>
          ))}
          {visible.length === 0 && <span className="no-results">Brak wyników.</span>}
        </nav>

        <div className="help-content" ref={contentRef}>
          {visible.map((s) => (
            <details
              key={s.id}
              data-help-id={s.id}
              className="help-section"
              open={q ? true : openIds.has(s.id)}
              onToggle={(e) => {
                if (!q) toggle(s.id, (e.target as HTMLDetailsElement).open)
              }}
            >
              <summary>{s.title}</summary>
              <div className="help-section-body">{s.body}</div>
            </details>
          ))}
          {visible.length === 0 && (
            <p className="no-results">Nic nie znaleziono dla „{query}". Spróbuj innego słowa.</p>
          )}
          <p className="help-footer">
            Czegoś brakuje albo coś działa inaczej niż opisano? Zgłoś przyciskiem „Zgłoś uwagę" —
            uzupełnimy instrukcję.
          </p>
        </div>
      </div>
    </div>
  )
}
