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
          <li>Nowa kolumna <b>DO ZAMÓWIENIA</b> = ile brakuje do minimum po uwzględnieniu tego, co w drodze. Przyciski <b>„Eksportuj braki (CSV)"</b> (gotowa lista do zamówienia) i <b>„Braki → lista zakupowa"</b> (wrzuca braki do Zamawiania).</li>
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
          <li><b>Zamówienia</b> — kategorie, a pod nimi <b>Weryfikacja</b> (duble, braki numerów, błędy ERP) i <b>Archiwum</b>.</li>
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
          ZREALIZOWANE, a docelowo do Archiwum).
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
          <li><b>Statystyki</b> (Analizy) — produkcja wg kategorii (wykresy statusów, trendy), reklamacje (co i dlaczego reklamowane), drzwi wewnętrzne, produktywność, czasy realizacji, zużycie magazynu (miesięczne zejścia per komponent).</li>
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
        <p className="help-note">Archiwum zrealizowanych zleceń jest w grupie Zamówienia, Audyt w Analizach.</p>
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
            albo anulowane. Sprawdź na dole tabeli (ZREALIZOWANE), w Archiwum albo przez Ctrl+K.
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
