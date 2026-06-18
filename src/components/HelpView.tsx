import packageJson from '../../package.json'

type Section = { title: string; body: React.ReactNode }

const SECTIONS: Section[] = [
  {
    title: '🚪 Zamówienia — podstawy',
    body: (
      <>
        <p>Każda kategoria drzwi ma swoją zakładkę: <b>STA, Disting, ST, Techniczne, Bastion, Drzwi wewnętrzne</b>. Lista pokazuje aktywne zlecenia (bez wydanych).</p>
        <ul>
          <li><b>Dodanie zlecenia</b> — przycisk „Nowe zamówienie", wypełniasz pola (część z list słownikowych).</li>
          <li><b>Edycja</b> — klik w wiersz otwiera okno zlecenia (tylko kierownik/sprzedawca).</li>
          <li><b>Etapy produkcji</b> — kliknięcie pustej komórki etapu wstawia <b>Twoje inicjały</b> (oznaczasz że zrobione). Klik w wypełnioną = cofnięcie (z potwierdzeniem).</li>
          <li><b>Pilne ⚡</b> — checkbox „PILNE" podbija zlecenie na górę i wyróżnia.</li>
          <li><b>Wydanie</b> — kolumna WYDANIE: klik = oznacz datą dzisiejszą (zlecenie znika z listy, trafia do Wysyłki/Archiwum).</li>
          <li><b>Anuluj / Przywróć</b> — w kolumnie Akcje (kierownik).</li>
          <li><b>Komentarze 💬</b> — przy numerze; możesz oznaczać osoby przez <code>@</code>.</li>
          <li><b>Szukajka</b> — <code>Ctrl+K</code> globalne wyszukiwanie zleceń.</li>
        </ul>
      </>
    ),
  },
  {
    title: '🔗 Disting Plus (STA ↔ Disting)',
    body: (
      <>
        <p>Zamówienie z systemem <b>DISTING PLUS</b> (tworzone w zakładce Disting lub z API) tworzy <b>parę</b>: rekord Disting + rekord STA, połączone.</p>
        <ul>
          <li>Ościeżnica robiona po stronie <b>Disting</b>, skrzydło po stronie <b>STA</b>.</li>
          <li>Etapy się <b>mirrorują</b> — oznaczenie po jednej stronie widać po drugiej (kolumny tylko do odczytu).</li>
          <li>W STA kolumna <b>OŚĆ</b> pokazuje status pakowania ościeżnicy z Disting (E5).</li>
        </ul>
      </>
    ),
  },
  {
    title: '🛡️ Titan / Bastion (CORE, GUARD RC2/RC3)',
    body: (
      <>
        <p>Zlecenie z systemem <b>CORE / GUARD RC2 / GUARD RC3 / GUARD RC3 EI 30</b> tworzy <b>trzy</b> powiązane rekordy: STA + ST + Bastion.</p>
        <ul>
          <li><b>STA</b> — frezuje skrzydło (etapy E3, E5), reszta zablokowana.</li>
          <li><b>ST</b> — robi ościeżnicę (etap OŚCIEŻNICA), reszta zablokowana.</li>
          <li><b>Bastion</b> — stacja końcowa: <b>okuwanie → montaż → pakowanie</b> (3 kroki). Chipy przy numerze pokazują czy <b>OŚC</b> (ościeżnica z ST) i <b>SKRZ</b> (skrzydło ze STA) już dojechały.</li>
          <li>Każda ekipa oznacza tylko swoje etapy. Wydanie jest niezależne dla każdej kategorii.</li>
        </ul>
      </>
    ),
  },
  {
    title: '✅ Moje stanowisko',
    body: (
      <p>Lista zadań przypisanych do Ciebie — etapy gotowe do zrobienia (najpierw pilne i gotowe do pracy). Rozwijasz kartę zlecenia, widzisz szczegóły, klikasz „Oznacz jako zrobione".</p>
    ),
  },
  {
    title: '🚛 Wysyłka',
    body: (
      <>
        <p>Zlecenia gotowe do wydania (kierownik). Pokazuje postęp etapów i status.</p>
        <ul>
          <li><b>Pasek postępu</b> — ile etapów ukończonych (najedź by zobaczyć listę etapów).</li>
          <li><b>Gotowe do fakturowania</b> — checkbox; sugerowane gdy 100% etapów lub jest data wydania.</li>
          <li>Sortowanie po dniu trasy firmy, ostrzeżenia o przeterminowanych.</li>
        </ul>
      </>
    ),
  },
  {
    title: '📦 Magazyn',
    body: (
      <>
        <ul>
          <li><b>Stany</b> — ilości komponentów per magazyn (Bukowa, Marklowicka, Wewnętrzne).</li>
          <li><b>Komponenty</b> — kartoteka surowców i drzwi wewnętrznych; przy tworzeniu wybierasz <b>magazyny</b>, do których komponent należy. „Wyczyść błędne półki" porządkuje przypisania.</li>
          <li><b>Przyjęcia (PZ)</b> — przyjęcie towaru; filtr po <b>dostawcy</b> i kategorii; jednostki sztukowe = liczby całkowite.</li>
          <li><b>Przesunięcia (MM)</b> — między magazynami.</li>
          <li><b>Receptury</b> — co schodzi z magazynu na dane zlecenie (auto przy realizacji).</li>
          <li><b>Zamawianie</b> — sugestie zamówień (ROP), lista zakupowa, zamówienia do dostawców.</li>
          <li><b>Inwentaryzacja</b> — remanent: eksport PDF do liczenia + wprowadzanie stanów.</li>
          <li><b>Alerty / Prognozy</b> — braki i przewidywane zużycie.</li>
        </ul>
      </>
    ),
  },
  {
    title: '🏷️ Etykiety',
    body: (
      <>
        <p>Dwa rodzaje druku:</p>
        <ul>
          <li><b>Etykieta zlecenia (dynamiczna)</b> — otwórz zlecenie → <b>„🏷️ Drukuj etykietę"</b>. Program dobiera szablon wg kategorii, podstawia dane + kod QR (ID zlecenia), pokazuje podgląd. Drukujesz na wybraną drukarkę.</li>
          <li><b>Dokumenty (DoP / deklaracje, ZPL)</b> — zakładka Etykiety → Dokumenty. Gotowe pliki ZPL per kategoria, drukujesz np. 100 szt. na Zebrę.</li>
        </ul>
        <p><b>Konfiguracja (kierownik):</b> Etykiety → Szablony — tworzysz szablony HTML per kategoria (jest instrukcja i lista wszystkich dostępnych pól). W „Dokumenty" dodajesz drukarki Zebra (IP) i wgrywasz pliki ZPL.</p>
      </>
    ),
  },
  {
    title: '🔔 Powiadomienia i aktualizacje',
    body: (
      <>
        <ul>
          <li><b>Dzwonek</b> (góra) — powiadomienia, m.in. nowe zamówienia z konfiguratora wymagające weryfikacji.</li>
          <li><b>Aktualizacje</b> — program sam sprawdza nową wersję po zalogowaniu i proponuje update. Wystarczy zaakceptować.</li>
        </ul>
      </>
    ),
  },
  {
    title: '⚙️ Konfiguracja i uprawnienia (kierownik)',
    body: (
      <>
        <ul>
          <li><b>Konfiguracja</b> — słowniki (systemy, kolory, okucia…), wykluczenia, czasy realizacji, ustawienia firmy.</li>
          <li><b>Kontrahenci</b> — firmy, aliasy nazw, dni tras.</li>
          <li><b>Użytkownicy</b> — konta, role (kierownik/pracownik/sprzedawca), działy (decydują co kto widzi).</li>
          <li><b>Klucze API</b> — dla konfiguratora / integracji (zamówienia wpadają automatem).</li>
          <li><b>Audyt / Archiwum</b> — historia zmian i zrealizowane zlecenia.</li>
        </ul>
      </>
    ),
  },
]

export default function HelpView() {
  return (
    <div className="help-view">
      <div className="help-intro">
        <h2>Instrukcja — KR Center Manager</h2>
        <p>Krótki przewodnik po programie. Rozwijaj sekcje poniżej. Wersja aplikacji: <b>{packageJson.version}</b>.</p>
      </div>
      {SECTIONS.map((s, i) => (
        <details key={i} className="help-section" open={i === 0}>
          <summary>{s.title}</summary>
          <div className="help-section-body">{s.body}</div>
        </details>
      ))}
      <p className="help-footer">Czegoś brakuje albo coś działa inaczej? Daj znać — dopiszemy.</p>
    </div>
  )
}
