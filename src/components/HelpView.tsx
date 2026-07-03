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
          <li><b>Administrator</b> — pełny dostęp, w tym panel administracyjny (Użytkownicy, Konfiguracja, Klucze API, Kontrahenci).</li>
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
          <li>Kliknięcie <b>wypełnionej</b> komórki = cofnięcie etapu (z potwierdzeniem; pracownik produkcji cofa tylko swoje przypisane etapy).</li>
          <li>Etap uznaje się za wykonany, gdy komórka jest <b>niepusta</b> — dlatego widać inicjały wykonawcy, nie „ptaszek".</li>
        </ul>
        <h4>Pilne i wydanie</h4>
        <ul>
          <li><b>PILNE ⚡</b> — checkbox podbija zlecenie na górę listy i wyróżnia kolorem.</li>
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
          <li><b>Czerwonawy</b> — pilne. <b>Zielonkawy / ZREALIZOWANE</b> — wydane. <b>Wyszarzony</b> — anulowane.</li>
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
        <ul>
          <li><b>Gotowe do pracy</b> — poprzednie etapy zlecenia są ukończone, możesz działać.</li>
          <li><b>Czeka na poprzednie</b> — jeszcze nie Twoja kolej; zadanie zablokowane.</li>
          <li>Kliknięcie wiersza rozwija <b>szczegóły istotne dla Twojego etapu</b> (wymiary, kolory, szklenia, dostawki…).</li>
          <li><b>✓ Zrobione</b> — oznacza etap Twoimi inicjałami (z potwierdzeniem).</li>
          <li>Pilne zlecenia są wyróżnione i sortowane wyżej.</li>
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
          <li>W tabeli zaznacz zlecenia <b>checkboxami przy numerze</b> (można z różnych kategorii).</li>
          <li>W prawym górnym rogu pojawi się <b>„Drukuj komplet (N)"</b>.</li>
          <li>W oknie: wybierz drukarkę, zaznacz co drukować (☑ etykieta QR, ☑ DoP), ustaw <b>liczbę etykiet per zlecenie</b> — np. drzwi z naświetlem i dostawką = 3 szt. Znaczniki <i>dostawka</i>/<i>naświetle</i> przy każdym wierszu podpowiadają ile dać.</li>
          <li>Program drukuje po kolei z paskiem postępu i raportem (ile OK, ile pominięto).</li>
        </ol>
        <h4>Konfiguracja (kierownik)</h4>
        <ul>
          <li><b>Etykiety → Szablony etykiet</b> — szablony HTML per kategoria; edytor ma instrukcję, listę pól (np. <code>{'{{nr_zlecenia}}'}</code>, <code>{'{{qr}}'}</code>, <code>{'{{panel_gorny}}'}</code>) i podgląd w rzeczywistym rozmiarze. ⭐ = szablon domyślny.</li>
          <li><b>Etykiety → Dokumenty</b> — wgrywasz pliki ZPL (deklaracje) i przypisujesz cechy doboru (system, realizator, szklone/pełne, ościeżnica). Puste pole = „dowolne". „Drukuj paczkę" drukuje wszystkie dokumenty kategorii naraz.</li>
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
        <ul>
          <li><b>Stany</b> — ilości komponentów w podziale na magazyny (Bukowa, Marklowicka, Wewnętrzne #1/#2).</li>
          <li><b>Komponenty</b> — kartoteka surowców i drzwi; przy tworzeniu wskazujesz magazyny, do których komponent należy; kod generuje się automatycznie.</li>
          <li><b>Przyjęcia (PZ)</b> — przyjęcie towaru; filtry po dostawcy i kategorii; jednostki sztukowe przyjmują tylko liczby całkowite, mb/kg — dziesiętne.</li>
          <li><b>Przesunięcia (MM)</b> — ruchy między magazynami.</li>
          <li><b>Receptury</b> — definiują co schodzi ze stanu przy realizacji zlecenia (dobór po kategorii/systemie/modelu/kolorze). Zejście następuje automatycznie przy dodaniu zlecenia; anulowanie zwraca komponenty.</li>
          <li><b>Zamawianie</b> — sugestie zakupów (ROP z prognozą sezonową), lista zakupowa, zamówienia do dostawców z wydrukiem PDF.</li>
          <li><b>Inwentaryzacja</b> — remanent: eksport arkusza PDF do liczenia, potem wprowadzenie stanów rzeczywistych.</li>
          <li><b>Alerty</b> — braki i przewidywane wyczerpanie; licznik przy grupie Magazyn w panelu bocznym.</li>
        </ul>
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
          <li><b>Statystyki</b> — produkcja wg kategorii (wykresy statusów, trendy), reklamacje (co i dlaczego reklamowane), drzwi wewnętrzne, produktywność, czasy realizacji.</li>
          <li>Wykres statusu pokazuje sumę drzwi w środku, procenty na wycinkach i legendę z wartościami.</li>
        </ul>
      </>
    ),
  },
  // ── 13. Administracja ─────────────────────────────────────────────
  {
    id: 'admin',
    title: '⚙️ Administracja (admin/kierownik)',
    keywords: 'konfiguracja słowniki wykluczenia użytkownicy klucze api kontrahenci audyt archiwum czasy realizacji',
    body: (
      <>
        <ul>
          <li><b>Konfiguracja</b> — słowniki pól formularzy (systemy, modele, kolory, okucia…), wykluczenia niedozwolonych kombinacji, wymiary/poszerzenia, czasy realizacji (terminy ostrzeżeń), opcje ościeżnic Bastion (mnożniki etykiet).</li>
          <li><b>Kontrahenci</b> — baza firm: dni produkcji/tras, dane logistyczne, scalanie aliasów nazw.</li>
          <li><b>Użytkownicy</b> — konta, role, przypisane kategorie, przypisane etapy pracowników („Etapy produkcji"). Hasła nadaje się przy tworzeniu konta.</li>
          <li><b>Klucze API</b> — klucze dla integracji (konfigurator, Excel): generowanie, dezaktywacja, statystyki użycia i limity.</li>
          <li><b>Audyt</b> — pełna historia zmian: kto, kiedy, co zmienił.</li>
          <li><b>Archiwum</b> — zrealizowane zlecenia (podstawa do tworzenia reklamacji).</li>
        </ul>
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
