// Prompty i schematy doboru, maila i poprawki. Port z oferta/prototyp.py (ten sam tekst, te same zasady).
// SLOWNIK jest kopią z crm-call-ingest/prompt.ts (funkcje Edge nie dzielą plików przy wdrażaniu): zmieniasz tu = zmień tam.
import { blokStyluSystem, blokStyluUser, type Styl } from './styl.ts'

export const HANDLOWIEC = { imie: 'Magdalena', podpis: 'Magdalena\nPo Drzwi\ntel. 504 800 103\nkontakt@podrzwi.pl' }

export const SLOWNIK = `Słownik branżowy (ważne, żeby nie pomylić danych):
- „dziewięćdziesiątka / 90-tka / osiemdziesiątka” = nominalna szerokość skrzydła (rozmiar 80/90/100, warianty E/T/N), NIE wymiar otworu w murze;
- wymiar otworu (w murze) ≠ wymiar skrzydła ≠ wymiar zewnętrzny ościeżnicy;
- lewe/prawe = kierunek otwierania wg normy: stojąc po stronie, na którą drzwi się otwierają (do siebie), zawiasy po lewej = lewe;
- drzwi zewnętrzne do domu otwierane są na zewnątrz; drzwi do mieszkania zwykle do wewnątrz;
- RC2 / RC3 = klasa antywłamaniowa; Titan = Bastion Titan (RC3, drzwi do mieszkań);
- systemy KR Center drzwi zewnętrznych: Steel Extra (stal), Alu, Alu extra, Alu extra RC2 (ościeżnica aluminiowa), Wood extra (ościeżnica drewniana);
- wzory KR Center: Otto NN, Libre NN; warianty panelu: brak (inox), Noir Matt (czarny mat), Gold (stare złoto); „z pochwytem” = osobna linia produktów;
- Steel Extra ma tylko panel inox albo Noir Matt (wariantu Gold w Steel Extra nie ma, nie pytaj o niego klienta); Gold jest w Alu extra i Wood extra;
- Bastion A-NNN / B-NNN = drewniane drzwi do mieszkania, systemy Basic / Basic Plus / Basic Lock Plus / Premium / Premium RC2;
- okucia: Haga, Haga Premium (wkładka klasy B), Trust (antywłamaniowe), Logo (Steel Extra), Mati; kolory: inox/srebrny, czarny mat, stare złoto;
- osłonki na zawiasy, wizjer, przeszklenie (lustro weneckie, antisol, satyna);
- EI30/EI60 = przeciwpożarowe; Ud/U = przenikanie ciepła; „Czyste Powietrze” = dotacja z wymaganiami cieplnymi;
- klienci mogą mówić gwarą śląską.`

export type Analiza = {
  typ: string; nazwa: string; miejscowosc: string; email: string; telefon: string; kategoria: string; potrzeba: string
  dane: Record<string, string | number>; brakuje: string[]; ustalenia_z_rozmowy: string[]; podsumowanie: string; nastepna_akcja: string
  /** dopisane przez aplikację: poprawka ustaleń przed liczeniem (21.11) i odpowiedzi na pytania systemu po nieudanym doborze (24.11) */
  poprawka_handlowca?: string; odpowiedzi_handlowca?: string
}

/** Kategoria „drzwi wewnętrzne dostępne od ręki” w sklepie — link do maila, gdy klient chce sam wybrać modele (Perzanowski 24.11) */
export const LINK_OD_REKI = 'https://podrzwi.pl/kategoria/drzwi-wewnetrzne/drzwi-wewnetrzne-od-reki/'

/** Jedna pozycja oferty sklepowej: produkt z kandydatów + jego wybory + liczba identycznych sztuk (kilka drzwi w jednej ofercie, 2026-11-16). */
export const SCHEMA_POZYCJA = {
  type: 'object',
  properties: {
    product_id: { type: 'integer', description: 'Produkt z listy kandydatów' },
    ilosc: { type: 'integer', description: 'Liczba identycznych sztuk tej pozycji (zwykle 1)' },
    wybory: { type: 'array', items: { type: 'object', properties: { pole: { type: 'string' }, wybor: { type: 'string' } }, required: ['pole', 'wybor'], additionalProperties: false },
      description: 'Pełne wybory tej pozycji, etykiety DOKŁADNIE jak w spisie pól (pola typu product: numer ID produktu dodatkowego)' },
    opis: { type: 'string', description: 'Krótko, czym ta pozycja różni się od pozostałych, np. „pokojowe, 80 prawe”; pusty tekst przy jednej pozycji' },
  },
  required: ['product_id', 'ilosc', 'wybory', 'opis'],
  additionalProperties: false,
} as const

export const SCHEMA_DOBOR = {
  type: 'object',
  properties: {
    product_id: { type: 'integer' },
    uzasadnienie: { type: 'string' },
    wybory: { type: 'array', items: { type: 'object', properties: { pole: { type: 'string' }, wybor: { type: 'string' } }, required: ['pole', 'wybor'], additionalProperties: false } },
    zalozenia: { type: 'array', items: { type: 'string' }, description: 'Decyzje konfiguracyjne podjęte bez potwierdzenia klienta i BEZ zasady domyślnej firmy: handlowiec ma je sprawdzić' },
    domyslne: { type: 'array', items: { type: 'string' }, description: 'Decyzje wynikające z zasad domyślnych firmy, bo klient tego nie ustalił; mail o nich wspomni, handlowiec nie musi sprawdzać. Jedno krótkie zdanie każda, np. „Kolor: Antracyt gładki (domyślny)”' },
    pewnosc: { type: 'string', enum: ['wysoka', 'srednia', 'niska'] },
    pasuje: { type: 'boolean', description: 'true = wybrany produkt odpowiada potrzebie klienta; false = ŻADEN kandydat nie pasuje (inny rodzaj drzwi niż kandydaci, np. do mieszkania na istniejącej ościeżnicy, przeciwpożarowe EI, nietypowe/przetarg) — wtedy oferty NIE wysyłamy, handlowiec zajmie się sam' },
    pozycje: { type: 'array', items: SCHEMA_POZYCJA,
      description: 'WSZYSTKIE drzwi z oferty: każda inna konfiguracja (inny produkt, rozmiar, kierunek, kolor, wzór…) to osobna pozycja; identyczne sztuki łączysz przez `ilosc`. Przy jednych drzwiach dokładnie jedna pozycja, ta sama co `product_id` + `wybory`. Pierwsza pozycja = `product_id` + `wybory`.' },
    pytania: { type: 'array', items: { type: 'string' },
      description: 'Gdy `pasuje` = false: 2–5 krótkich, konkretnych pytań do handlowca (który je zada klientowi albo odpowie sam), których odpowiedzi pozwolą dobrać produkt ze sklepu — np. „Drzwi wejściowe do mieszkania czy na zewnątrz budynku?”, „Który system: Titan (stalowe) czy Bastion (drewniane)?”, „Jaki wzór/model?”, „Rozmiar i kierunek?”. Jeśli sklep na pewno nie ma takiego produktu (EI, przetarg), jedno pytanie o to, czy wycenić ręcznie. Gdy `pasuje` = true: pusta lista.' },
    poza_wycena: { type: 'string',
      description: 'Potrzeby poboczne klienta, których NIE wyceniamy w tej ofercie, jedno–dwa zdania do maila: np. „Dodatkowo drzwi wewnętrzne z magazynu do łazienki i 2 pokoi, klient sam wybierze modele” albo „Tunel 120 cm do sprawdzenia”. Pusty tekst, gdy klient chce tylko to, co w ofercie.' },
  },
  required: ['product_id', 'uzasadnienie', 'wybory', 'zalozenia', 'domyslne', 'pewnosc', 'pasuje', 'pozycje', 'pytania', 'poza_wycena'],
  additionalProperties: false,
} as const
export type PozycjaDoboru = { product_id: number; ilosc: number; wybory: { pole: string; wybor: string }[]; opis: string }
export type Dobor = { product_id: number; uzasadnienie: string; wybory: { pole: string; wybor: string }[]; zalozenia: string[]; domyslne?: string[]; pewnosc: string; pasuje?: boolean; pozycje?: PozycjaDoboru[]
  pytania?: string[]; poza_wycena?: string }

/** Brak kandydatów w prefiltrze (24.11): zamiast „nie dobrano” system pyta o to, co pozwoli dobrać produkt. */
export const SCHEMA_PYTANIA = {
  type: 'object',
  properties: { pytania: { type: 'array', items: { type: 'string' } } },
  required: ['pytania'], additionalProperties: false,
} as const
export function promptPytan(analiza: Analiza) {
  const system = 'System Po Drzwi nie znalazł w sklepie podrzwi.pl kandydatów do wyceny drzwi dla klienta. Twoje zadanie: napisać 2–5 krótkich, konkretnych pytań '
    + 'do handlowca (zada je klientowi albo odpowie sam), których odpowiedzi pozwolą dobrać produkt. Odpowiadasz wyłącznie JSON-em wg schematu, po polsku. '
    + 'Linie w sklepie: drzwi wejściowe do mieszkania (wewnątrzklatkowe) Titan (stalowe, wzory G-01…) i Bastion (drewniane, wzory A-101…, B-…); '
    + 'drzwi zewnętrzne Alu extra / Alu extra RC2 / w systemie Alu (wzory Otto, Libre), Wood extra, Steel extra; drzwi wewnętrzne (ramiakowe, płytowe, '
    + 'przylgowe/bezprzylgowe/przesuwne, Vivento, akustyczne Bastion Interior, kolekcje „dostępne od ręki”). Nie pytaj o to, co już jest w danych. '
    + 'Pytaj najpierw o rodzaj drzwi i linię/system, potem o wzór, rozmiar, kierunek. Jeśli z danych wynika, że sklep takiego produktu nie ma (EI, przetarg, nietypowe), '
    + 'jedno pytanie: czy wycenić ręcznie.\n\n' + SLOWNIK
  const user = `Dane z rozmowy:\n${JSON.stringify(analiza, null, 1)}`
  return { system, user }
}

export const SCHEMA_MAIL = {
  type: 'object',
  properties: { temat: { type: 'string' }, tresc: { type: 'string' } },
  required: ['temat', 'tresc'], additionalProperties: false,
} as const
export type Mail = { temat: string; tresc: string }

/** Skąd jest oferta: rozmowa z Ringostatu, mail klienta, notatka handlowca po wizycie w salonie albo po innej rozmowie. */
export type Kanal = 'telefon' | 'mail' | 'wizyta' | 'notatka'
const WSTEP_MAILA: Record<Kanal, string> = {
  telefon: 'która właśnie rozmawiała z nim przez telefon.',
  mail: 'która odpowiada na jego mail.',
  wizyta: 'która właśnie rozmawiała z nim osobiście w salonie Po Drzwi (klient przyszedł obejrzeć drzwi).',
  notatka: 'która właśnie z nim rozmawiała (poniżej jej notatka z tej rozmowy).',
}

export const SCHEMA_POPRAWKA = {
  type: 'object',
  properties: {
    product_id: { type: 'integer', description: 'Nowy produkt z listy innych produktów albo 0, jeśli produkt zostaje' },
    zmiany: { type: 'array', items: { type: 'object', properties: { pole: { type: 'string' }, wybor: { type: 'string' } }, required: ['pole', 'wybor'], additionalProperties: false },
      description: 'Pola do zmiany; etykiety DOKŁADNIE jak w spisie pól (pola typu product: numer ID produktu dodatkowego)' },
    usun: { type: 'array', items: { type: 'string' }, description: 'Nazwy pól, które mają zostać odznaczone (np. rezygnacja z osłonek)' },
    do_maila: { type: 'string', description: 'Uwagi handlowca do TREŚCI maila, nie do konfiguracji; pusty tekst, jeśli brak' },
    niezrozumiane: { type: 'array', items: { type: 'string' }, description: 'Fragmenty poprawki, których nie dało się odwzorować na pola' },
    dostawa: { type: 'string', enum: ['', 'kurier', 'odbior_osobisty'], description: 'Tylko gdy poprawka dotyczy dostawy (kurier / odbiór osobisty); inaczej pusty tekst' },
    streszczenie: { type: 'string', description: 'Jedno zdanie: co zmieniono' },
    pozycja: { type: 'integer', description: 'Numer pozycji oferty (od 1), której dotyczą `product_id`, `zmiany`, `usun` i `ilosc`; 0 = wszystkich pozycji (albo oferta ma jedną)' },
    ilosc: { type: 'integer', description: 'Nowa liczba sztuk tej pozycji; 0 = bez zmian' },
    usun_pozycje: { type: 'array', items: { type: 'integer' }, description: 'Numery pozycji (od 1) do skasowania z oferty; zwykle pusta lista' },
    nowe_pozycje: { type: 'array', items: SCHEMA_POZYCJA, description: 'Dodatkowe drzwi dopisane poprawką, każda z PEŁNYMI wyborami jak w spisie pól; zwykle pusta lista' },
    od_nowa: { type: 'boolean', description: 'true, gdy handlowiec prosi o przeliczenie / dobór od nowa („zrób jeszcze raz”, „policz od nowa”, „jeszcze raz całość”) albo obecne wybory są tak pomieszane (pola z innego produktu), że trzeba dobrać wszystko od zera; wtedy zmiany/usun zostaw puste. Inaczej false.' },
  },
  required: ['product_id', 'zmiany', 'usun', 'do_maila', 'niezrozumiane', 'dostawa', 'streszczenie', 'pozycja', 'ilosc', 'usun_pozycje', 'nowe_pozycje', 'od_nowa'],
  additionalProperties: false,
} as const
export type Poprawka = { product_id: number; zmiany: { pole: string; wybor: string }[]; usun: string[]; do_maila: string; niezrozumiane: string[]; dostawa: '' | 'kurier' | 'odbior_osobisty'; streszczenie: string
  pozycja?: number; ilosc?: number; usun_pozycje?: number[]; nowe_pozycje?: PozycjaDoboru[]; od_nowa?: boolean }

/** 27.11: naprawa po policzeniu — pozycje z brakującymi wymaganymi polami albo wyborami spoza spisu pól (pełne wybory od nowa). */
export const SCHEMA_NAPRAWA = {
  type: 'object',
  properties: {
    pozycje: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lp: { type: 'integer', description: 'numer pozycji z listy problemów' },
          wybory: { type: 'array', items: { type: 'object', properties: { pole: { type: 'string' }, wybor: { type: 'string' } }, required: ['pole', 'wybor'], additionalProperties: false },
            description: 'PEŁNE wybory tej pozycji (wszystkie pola, nie tylko poprawiane), etykiety DOKŁADNIE jak w spisie pól jej produktu; pola typu product: numer ID produktu dodatkowego' },
          uwaga: { type: 'string', description: 'czego nie dało się ustalić (pusty tekst, gdy wszystko jasne)' },
        },
        required: ['lp', 'wybory', 'uwaga'], additionalProperties: false,
      },
    },
  },
  required: ['pozycje'], additionalProperties: false,
} as const
export type Naprawa = { pozycje: { lp: number; wybory: { pole: string; wybor: string }[]; uwaga: string }[] }

export function promptNaprawy(analiza: Analiza, problemy: { lp: number; product_id: number; opis: string; wybory: Record<string, string | number>; braki: string[]; spis: string }[], poprawka: string) {
  const system = 'Oferta drzwi ze sklepu podrzwi.pl ma pozycje, których sklep nie przyjmie: brakuje wymaganych pól albo wybory nie pasują do spisu pól produktu '
    + '(np. nazwy pól przepisane z innego produktu). Dla każdej pozycji z listy podaj PEŁNE wybory od nowa, DOKŁADNIE wg spisu pól jej produktu, '
    + 'zachowując to, co już ustalono (kolor, rozmiar, kierunek, okucia, dodatki — przenieś je na właściwe pola tego produktu). Pola z gwiazdką wypełnij zawsze; '
    + 'brakującą rzecz ustal z danych klienta, a gdy jej tam nie ma, wybierz najbardziej typową opcję i napisz to w `uwaga`. Pola warunkowe wypełniaj tylko, gdy pasują. '
    + 'Odpowiadasz wyłącznie JSON-em wg schematu. Nie liczysz cen.\n\n' + SLOWNIK
  const user = `Dane klienta:\n${JSON.stringify(analiza, null, 1)}`
    + (poprawka ? `\n\nOstatnia prośba handlowca: „${poprawka}”` : '')
    + '\n\nPOZYCJE DO NAPRAWY:\n' + problemy.map((p) => `--- Pozycja ${p.lp}: produkt #${p.product_id}${p.opis ? ` (${p.opis})` : ''}\nObecne wybory: ${JSON.stringify(p.wybory)}\nProblemy: ${p.braki.join('; ')}\nSpis pól:\n${p.spis}`).join('\n\n')
  return { system, user }
}

export type Dostawa = { rodzaj: 'kurier' | 'odbior_osobisty'; koszt: number; zalozona: boolean }
export function opisDostawy(d: Dostawa): string {
  return d.rodzaj === 'kurier' ? `Dostawa kurierem: ${d.koszt.toFixed(2)} zł` : 'Odbiór osobisty: bez dopłaty'
}

type Kandydat = { id: number; nazwa: string; cena: number | null }

export function promptDoboru(analiza: Analiza, kand: Kandydat[], spisy: string, zasady: string[] = []) {
  const zasadyTekst = zasady.length
    ? 'ZASADY DOMYŚLNE firmy (gdy klient czegoś nie ustalił, stosuj je zamiast zgadywać; to, co wynika z zasady, wpisz do `domyslne`, '
      + 'NIE do `zalozenia`):\n' + zasady.map((z) => `- ${z}`).join('\n') + '\n'
    : ''
  const system = 'Dobierasz produkt ze sklepu podrzwi.pl i jego opcje do potrzeby klienta z rozmowy. Odpowiadasz wyłącznie JSON-em '
    + 'wg schematu. Wybierz `product_id` TYLKO z listy kandydatów. W `wybory` podaj etykiety DOKŁADNIE tak, jak w spisie pól '
    + '(dla pól typu `product` podaj numer ID produktu dodatkowego). Wypełnij wszystkie pola oznaczone gwiazdką; '
    + 'jeśli klient czegoś nie ustalił i NIE ma na to zasady domyślnej, wybierz najbardziej typową/bezkosztową opcję i wpisz to do `zalozenia`; '
    + 'jeśli jest zasada domyślna, zastosuj ją i wpisz do `domyslne`. '
    + 'Wyjątek: okucia. Oferta ma ZAWSZE zawierać komplet okuć z klamkami (standardowy zestaw klamka-klamka, najtańszy pełny zestaw '
    + 'w kolorze pasującym do drzwi, chyba że klient wskazał inny), także gdy klient o okucia nie pytał; wtedy dopisz JEDNO zdanie, '
    + 'że zestaw klamek przyjęto standardowo, a klient może wybrać pochwyt: do `domyslne`, jeśli jest zasada domyślna o okuciach, '
    + 'inaczej do `zalozenia`. Nigdy w obu miejscach naraz. '
    + '`zalozenia` to WYŁĄCZNIE decyzje konfiguracyjne podjęte bez potwierdzenia klienta (np. „kolor przyjęto jako Antracyt gładki, '
    + 'klient nie mówił o strukturze”), jedno zdanie każda, bez porad proceduralnych, bez uwag o terminie ważności ceny, '
    + 'o duplikatach rozmów ani o tym, co klient powinien sprawdzić. To, co klient wprost ustalił, nie jest założeniem. '
    + 'Nie liczysz cen, od tego jest kod. '
    + 'NIGDY nie dobieraj produktu „zastępczego”: jeśli klient potrzebuje czegoś, czego nie ma wśród kandydatów (drzwi do mieszkania montowane na istniejącej '
    + 'ościeżnicy, drzwi przeciwpożarowe EI30/EI60, stolarka do przetargu / zestawienia budowlanego, nietypowe wymiary), '
    + 'ustaw `pasuje` = false, w `uzasadnienie` napisz jednym zdaniem dlaczego, a w `product_id` podaj pierwszego kandydata (zostanie zignorowany). '
    + 'W pozostałych przypadkach `pasuje` = true. Gdy `pasuje` = false, w `pytania` wpisz 2–5 pytań, których odpowiedzi pozwolą dobrać produkt (patrz opis pola). '
    + 'Drzwi wejściowe do mieszkania z klatki schodowej (wewnątrzklatkowe, akustyczne 34–44 dB, RC2/RC3) to w sklepie linie Titan (stalowe) i Bastion (drewniane) — są normalnie do dobrania, '
    + 'o ile są wśród kandydatów. POTRZEBY POBOCZNE: jeśli klient oprócz głównych drzwi wspomina o czymś, czego nie konfigurujemy w tej ofercie (np. „do tego drzwi wewnętrzne '
    + 'z magazynu do łazienki i pokoi, modele wybierze sam”, „tunel 120 cm do sprawdzenia”), NIE jest to powód do `pasuje` = false ani do osobnej pozycji: dobierz główny produkt, '
    + 'a potrzeby poboczne opisz w `poza_wycena` (mail o nich wspomni, przy drzwiach wewnętrznych od ręki poda link do kategorii). '
    + 'Jeśli w danych jest `poprawka_handlowca` albo `odpowiedzi_handlowca` (handlowiec dopisał to po przeczytaniu ustaleń / po pytaniach systemu), ma to PIERWSZEŃSTWO przed resztą analizy. '
    + 'Drzwi WEWNĘTRZNE są w sklepie (ramiakowe i płytowe, przylgowe/bezprzylgowe/przesuwne, Vivento, akustyczne Bastion Interior): dla klienta na drzwi '
    + 'wewnętrzne wybierz je normalnie; wzór kolekcji (np. „Virello 02”, „Rivoli 01”) to zwykle opcja „Wariant”/„Wzór” produktu, a kolor, rozmiar, kierunek, '
    + 'ościeżnica i zamek to kolejne pola. Skrócenie skrzydła, nietypowa ościeżnica i inne rzeczy spoza pól wpisz do `zalozenia` jako „do ustalenia z klientem / dopłata ręcznie”. '
    + 'OD RĘKI: wiele kolekcji drzwi wewnętrznych ma dwa produkty: „Dostępne od ręki” (tańszy, z magazynu) i zwykły (na zamówienie). Zawsze wybieraj produkt '
    + '„Dostępne od ręki”, jeśli wszystkie wartości z konfiguracji klienta (wzór, kolor, rozmiar, ościeżnica, kierunek…) są w jego spisie pól. Gdy czegoś tam nie ma '
    + '(np. Rivoli w rozmiarze 100), wybierz zwykły produkt tej kolekcji i wpisz do `domyslne`: „Ten wariant nie jest dostępny od ręki, realizacja na zamówienie 6–7 tygodni”. '
    + 'KILKA DRZWI: jeśli klient potrzebuje więcej niż jednych drzwi (`ilosc` > 1, kilka rozmiarów, kierunków, wzorów albo modeli), wypisz je w `pozycje`: '
    + 'każda inna konfiguracja to osobna pozycja (ten sam produkt z innymi wyborami albo inny kandydat), identyczne sztuki łącz przez `ilosc`, '
    + 'w `opis` wpisz, czym pozycja się różni (np. „łazienkowe 80 lewe”). `product_id` i `wybory` to zawsze pierwsza pozycja. Jedne drzwi = jedna pozycja. '
    + 'Gdy wybierasz produkt bez spisu pól (poza 3 najlepszymi), użyj tych samych nazw pól, co w spisach tej samej rodziny produktów.\n\n'
    + zasadyTekst + SLOWNIK
  const lista = kand.map((p) => `- #${p.id}: ${p.nazwa} (cena bazowa ${p.cena} zł)`).join('\n')
  const user = `Dane z rozmowy:\n${JSON.stringify(analiza, null, 1)}\n\nKandydaci (produkt główny i produkty pozycji tylko z tej listy):\n${lista}\n\nSpis pól i wyborów dla 3 najlepszych kandydatów:\n${spisy}`
  return { system, user }
}

export function promptMaila(transkrypcja: string, analiza: Analiza, konfiguracja: unknown, rozbicie: string, link: string | null, waznyDo: string | null,
  mailWzor: Mail | null, uwagiHandlowca: string, kanal: Kanal = 'telefon', zasadyMaila: string[] = [], styl: Styl | null = null) {
  // #159 (18.11): mail w imieniu i stylu handlowca oferty (próbki z jego wysłanych maili), nie stałej „Magdaleny”
  const imie = styl?.imie ?? HANDLOWIEC.imie
  let system = `Piszesz mail do klienta w imieniu ${imie} z Po Drzwi, ${WSTEP_MAILA[kanal]} `
    + 'Odpowiadasz wyłącznie JSON-em: `temat` (krótki, max 8 słów) i `tresc` (czysty tekst, bez markdown). '
    + 'Ton: jak w rozmowie, ciepło i konkretnie, po polsku, bez korporacyjnego żargonu, bez wykrzykników w nadmiarze, '
    + 'krótkie akapity, treść maila do ok. 200 słów (bez listy konfiguracji i podpisu). '
    + 'Zaczynasz od „Dzień dobry Panie X / Pani Y”, jeśli nazwisko padło w rozmowie (odmienione poprawnie w wołaczu), '
    + 'inaczej samo „Dzień dobry”. '
    + 'Zwracasz się do rozmówcy (Pan/Pani), nie do „Państwa”, chyba że rozmawiały dwie osoby; żadnych uwag o rodzinie '
    + 'czy decyzjach domowych klienta, nawet żartobliwych.\n'
    + 'Zasady twarde:\n'
    + '1. Używasz WYŁĄCZNIE podanej ceny i konfiguracji: nie przeliczasz, nie dodajesz rabatów, nie wymyślasz terminów '
    + 'ważności ceny ani terminów realizacji, których nie ma w danych.\n'
    + '2. To, co handlowiec sam powiedział klientowi w rozmowie (parametry, współczynniki, czasy wysyłki), jest jego wiedzą: '
    + 'możesz to powtórzyć, nie zapowiadasz, że to „sprawdzisz” albo „potwierdzisz w dokumentacji”.\n'
    + '3. Nawiązujesz do konkretów z rozmowy (`ustalenia_z_rozmowy`).\n'
    + '4. Wypisujesz konfigurację czytelnie w punktach i podajesz cenę łączną brutto. Gdy oferta ma kilka pozycji (różne drzwi), '
    + 'każdą pozycję wypisujesz osobno z liczbą sztuk i jej ceną, a na końcu sumę za drzwi.\n'
    + '5. O potwierdzenie prosisz tylko w sprawach, które handlowiec zostawił otwarte W ROZMOWIE (np. rozmiar do pomiaru). '
    + 'Założenia z doboru (`zalozenia`, rzeczy przyjęte bez zasady firmy) pomijasz w mailu, handlowiec ma je w notatce i sam zdecyduje. '
    + 'Natomiast `domyslne` (rzeczy przyjęte wg zasad firmy, bo klient ich nie ustalił) wymieniasz w mailu krótko, w jednym akapicie '
    + 'albo w punktach, jako to, co przyjęłaś, i prosisz o sygnał, jeśli ma być inaczej. Jedyny inny wyjątek: gdy komplet klamek '
    + 'przyjęto standardowo (jest o tym w założeniach albo w domyślnych), możesz w jednym zdaniu zapytać, czy klient woli klamkę, czy pochwyt '
    + '(pochwyt to inna wersja drzwi, wtedy wycenę poprawisz).\n'
    + '6. Dopytujesz o brakujące dane z `brakuje` (analiza), zwłaszcza te, które blokują zamówienie (np. wymiar otworu), '
    + 'w jednym krótkim akapicie, konkretnymi pytaniami.\n'
    + '7. Jeśli podano link do koszyka: wklejasz go i piszesz, do kiedy jest ważny. Jeśli linku nie podano: nie wspominasz '
    + 'o koszyku ani o linku w ogóle.\n'
    + '8. Dostawa: w wycenie jest osobna pozycja dostawy. Podajesz cenę drzwi, potem dostawę (kurier z kwotą albo odbiór osobisty bez dopłaty) '
    + 'i kwotę RAZEM z dostawą. Koszyk w linku nie zawiera dostawy, więc jeśli wklejasz link, dopisujesz, że dostawa jest wybierana '
    + 'przy składaniu zamówienia.\n'
    + '9. Jeśli w „Dobrana konfiguracja” jest niepuste `poza_wycena` (potrzeby poboczne klienta, których ta oferta nie wycenia): jeden krótki akapit o tym. '
    + `Drzwi wewnętrzne, które klient ma wybrać sam (np. „dostępne od ręki” z magazynu): podajesz link do kategorii ${LINK_OD_REKI} i prosisz o wskazanie modeli. `
    + 'Rzeczy do sprawdzenia (np. nietypowy wymiar, tunel szerszy niż standard): piszesz, że sprawdzisz i dasz znać, bez obiecywania terminu ani ceny.\n'
    + (styl ? '10. Podpis: wg zasady PODPIS poniżej.' : `10. Kończysz dokładnie tym podpisem:\n${HANDLOWIEC.podpis}`)
  if (styl) system += '\n\n' + blokStyluSystem(styl) + ' Styl dotyczy sposobu pisania; zasady twarde powyżej (ceny, konfiguracja, link, dostawa) obowiązują zawsze.'
  if (zasadyMaila.length) system += '\n\nZasady firmy dotyczące treści maila (stosuj zawsze):\n' + zasadyMaila.map((z) => `- ${z}`).join('\n')
  if (mailWzor) {
    system += '\n\nTo jest POPRAWKA oferty przed wysłaniem, klient poprzedniej wersji nie widział. Dostajesz poprzednią wersję '
      + 'maila: zachowaj jej ton, układ i sformułowania, zmień tylko to, co wynika z nowej konfiguracji, nowej ceny '
      + 'i nowego linku, oraz uwzględnij uwagi handlowca. Nie pisz o „zmianie”, „poprawce” ani „aktualizacji”. '
      + 'Lista konfiguracji w mailu ma odpowiadać NOWEJ konfiguracji: porównaj każdy punkt poprzedniego maila z „Dobrana konfiguracja” '
      + 'i „Wycena” i popraw wszystko, co się różni (kolor, okucia, rozmiar, dodatki, kwoty).'
  }
  let user = `${kanal === 'telefon' ? 'Transkrypcja rozmowy' : 'Źródło oferty (zamiast transkrypcji)'}:\n${transkrypcja}\n\nAnaliza rozmowy:\n${JSON.stringify(analiza, null, 1)}\n\n`
    + `Dobrana konfiguracja:\n${JSON.stringify(konfiguracja, null, 1)}\n\n`
    + `Wycena (policzona przez kod, obowiązująca):\n${rozbicie}\n\n`
    + `Link do koszyka: ${link ?? '(nie podano)'}\nLink ważny do: ${waznyDo ?? '(nie podano)'}`
  if (mailWzor) user += `\n\nPoprzednia wersja maila (wzór tonu i układu):\nTemat: ${mailWzor.temat}\n${mailWzor.tresc}`
  if (uwagiHandlowca) user += `\n\nUwagi handlowca do treści maila: ${uwagiHandlowca}`
  if (styl) user += blokStyluUser(styl)
  return { system, user }
}

export type PozycjaPoprawki = { product_id: number; ilosc: number; wybory: Record<string, string | number>; opis: string }

export function promptPoprawki(pozycje: PozycjaPoprawki[], kand: Kandydat[], poprawka: string, opisOpcji: string) {
  const wiele = pozycje.length > 1
  const system = 'Handlowiec Po Drzwi sprawdził ofertę przygotowaną automatycznie i napisał poprawkę zwykłym językiem. Odwzorowujesz '
    + 'ją na konkretne zmiany konfiguracji produktu ze sklepu podrzwi.pl. Odpowiadasz wyłącznie JSON-em wg schematu. '
    + 'Zmieniasz TYLKO to, czego dotyczy poprawka, reszta zostaje bez zmian. Etykiety wyborów podajesz DOKŁADNIE tak, jak '
    + 'w spisie pól. Jeśli poprawka dotyczy treści maila (np. „dopisz, że…”), a nie konfiguracji, wpisujesz to do '
    + '`do_maila`. Jeśli poprawka dotyczy dostawy (kurier albo odbiór osobisty), ustawiasz `dostawa`, to nie jest pole produktu. '
    + 'Jeśli czegoś nie da się odwzorować, wpisujesz to do `niezrozumiane` i nie zgadujesz. Handlowiec ma '
    + 'zawsze rację co do tego, czego chce klient. Nie liczysz cen. '
    + 'Oferta może mieć kilka pozycji (różne drzwi), numerowane od 1: `pozycja` = numer pozycji, której dotyczą `product_id`, `zmiany`, `usun` i `ilosc` '
    + '(0 = wszystkich pozycji; przy jednej pozycji 0 albo 1). `ilosc` = nowa liczba sztuk (0 = bez zmian). `usun_pozycje` = numery pozycji do skasowania. '
    + '`nowe_pozycje` = dodatkowe drzwi dopisane poprawką (np. „dodaj jeszcze jedne 70 lewe”), każda z pełnymi wyborami jak w spisie pól, produkt z obecnych albo z listy innych. '
    + 'Zmiana produktu (`product_id` ≠ 0) dotyczy wskazanej pozycji. '
    // 27.11 (FHU KATO v14 → v15): handlowiec pisał, patrząc na starszą wersję („otwarty nie ten produkt, chodzi o Otto 49 z pochwytem”),
    // pozycja 1 już miała ten produkt, a model przepiął na niego pozycję 2 (Libre 31) — Libre zniknęło z oferty
    + 'Jeśli produkt, o który prosi handlowiec, JUŻ jest w ofercie (handlowiec mógł patrzeć na starszą wersję), NIE przenoś go na inną pozycję '
    + 'i nie zmieniaj produktu żadnej pozycji — uznaj to za spełnione (`product_id` = 0) i napisz to w `streszczenie`; wykonaj tylko pozostałe zmiany. '
    + 'Nigdy nie zamieniaj jednego wzoru na inny (np. Libre na Otto) w pozycji, której poprawka wprost nie wskazuje. '
    + 'Gdy handlowiec prosi o zrobienie / przeliczenie oferty od nowa („zrób jeszcze raz”, „policz od nowa”) bez wskazania konkretnej zmiany, ustaw `od_nowa` = true (nie wpisuj tego do `niezrozumiane`) — system dobierze wszystko od zera.\n\n' + SLOWNIK
  const obecne = new Set(pozycje.map((p) => p.product_id))
  const lista = kand.filter((p) => !obecne.has(p.id)).map((p) => `- #${p.id}: ${p.nazwa} (cena bazowa ${p.cena} zł)`).join('\n')
  const spis = pozycje.map((p, i) => `${i + 1}. produkt #${p.product_id}${p.ilosc > 1 ? ` × ${p.ilosc} szt.` : ''}${p.opis ? ` (${p.opis})` : ''}: ${JSON.stringify(p.wybory)}`).join('\n')
  const user = (wiele ? `Obecne pozycje oferty:\n${spis}` : `Obecny produkt: #${pozycje[0].product_id}${pozycje[0].ilosc > 1 ? ` × ${pozycje[0].ilosc} szt.` : ''}\nObecne wybory: ${JSON.stringify(pozycje[0].wybory)}`)
    + `\n\nPoprawka handlowca: „${poprawka}”\n\n`
    + `Spis pól i wyborów ${wiele ? 'obecnych produktów' : 'obecnego produktu'}:\n${opisOpcji}\n\n`
    + `Inne produkty, gdyby poprawka zmieniała model lub system (w przeciwnym razie product_id = 0):\n${lista || '- brak'}`
  return { system, user }
}

/** Wzory modeli Bastion w nazwach produktów i w rozmowie: A-104, P-110, N-201, T-…, L-01, LUX-401, STD-01 (myślnik opcjonalny). */
// runda 7 (recenzent): liczba cyfr zależy od litery — w cenniku 2 cyfry mają tylko L- i STD- (dotąd „b12”, „a10”, „t30”
// z rozmowy łapały się jako modele i zapychały listę Bastionami)
const BASTION_WZOR = /\b((?:lux|[abnpt])(?=-?\d{3}\b)|(?:l|std)(?=-?\d{2}\b))-?(\d{2,3})\b/
/** Numer produktu wpisany wprost przez handlowca: „ID 48895”, „#48895”, „id: 48895”, link z „?p=48895” / „product_id=48895”. */
// runda 7: także „id=48895” (tak odpowiedział handlowiec) i „ID produktu: 48895”
const ID_PRODUKTU = /(?:#|\bid\b(?:\s+produktu)?\s*[:=.]?\s*|[?&](?:p|post|product_id|add-to-cart)=)(\d{3,6})\b/gi
/** Link do produktu w sklepie: …/produkt/<slug>/ */
const LINK_PRODUKTU = /\/produkt\/([a-z0-9-]+)\/?/gi
/** Slug WooCommerce z nazwy produktu (małe litery, bez polskich znaków, myślniki). */
function slugProduktu(nazwa: string): string {
  return nazwa.toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[źż]/g, 'z')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
/** Produkty wskazane wprost w tekście (ID albo link do sklepu) — zawsze na początku listy kandydatów. */
function wskazaneProdukty(produkty: Kandydat[], tekst: string): Kandydat[] {
  const ids = new Set([...tekst.matchAll(ID_PRODUKTU)].map((m) => Number(m[1])))
  const slugi = new Set([...tekst.matchAll(LINK_PRODUKTU)].map((m) => m[1].toLowerCase().replace(/-\d+$/, '')))
  if (!ids.size && !slugi.size) return []
  return produkty.filter((p) => ids.has(p.id) || (slugi.size > 0 && slugi.has(slugProduktu(p.nazwa))))
}

/** Wzór drzwi z nazwy produktu: „otto 49”, „libre 31”, „otto 42b”, „g-05” (Titan), „a-104” (Bastion); null, gdy nazwa nie ma wzoru. */
export function wzorProduktu(nazwa: string): string | null {
  const n = String(nazwa ?? '').toLowerCase()
  // litera wariantu tylko przyklejona do numeru („42B”); „Otto 49 w systemie” to nie „49w”
  const m = n.match(/\b(otto|libre)\s*(\d+)([a-z]?)\b/)
  if (m) return `${m[1]} ${m[2]}${m[3]}`
  const g = n.match(/\bg-?(\d{2})\b/)
  if (g) return `g-${g[1]}`
  // 28.11 (Tymek: „wysłałem nazwę, link i ID, a on nadal nie umie wycenić Bastion P-110”): w cenniku są Bastiony A-, B-, N-, P-, T-
  // (3 cyfry), L- (2 cyfry), LUX- i STD- — dotąd rozpoznawane były tylko A/B
  const b = n.match(BASTION_WZOR)
  return b ? `${b[1]}-${b[2]}` : null
}

/** 27.11 (FHU KATO v15, Tymek: „mówię mu nawet jaki produkt chcę, a on wybiera inny”): poprawka podaje produkt (#65452 Otto 49 z pochwytem),
 *  a model przypina go do pozycji z INNYM wzorem (pozycja 2 = Libre 31), choć w ofercie jest pozycja z Otto 49. Produkt idzie wtedy do pozycji
 *  z tym samym wzorem. Wyjątek: poprawka wprost wskazuje pozycję (numer) albo jej wzór („w pozycji 2 zamiast Libre daj Otto 49”) — zostaje wybór modelu. */
export function celeWgWzoru<T extends { product_id: number }>(pozycje: T[], cele: T[], nowy: number, nazwa: (pid: number) => string, poprawka: string): T[] {
  const w = wzorProduktu(nazwa(nowy))
  if (!w || !cele.length) return cele
  const obce = cele.filter((p) => wzorProduktu(nazwa(p.product_id)) !== w)
  if (!obce.length) return cele
  const t = String(poprawka ?? '').toLowerCase()
  const rodzina = (x: string) => x.split(/[\s-]/)[0]
  const wskazana = obce.some((p) => {
    const wp = wzorProduktu(nazwa(p.product_id))
    const nr = pozycje.indexOf(p) + 1
    if (nr > 0 && new RegExp(`poz(?:ycj[aęi]|\\.)?\\s*(?:nr\\.?\\s*)?${nr}\\b`).test(t)) return true
    if (!wp) return false
    return t.includes(wp) || (rodzina(wp) !== rodzina(w) && new RegExp(`\\b${rodzina(wp)}`).test(t))
  })
  if (wskazana) return cele
  const pasujace = pozycje.filter((p) => wzorProduktu(nazwa(p.product_id)) === w)
  return pasujace.length ? pasujace : cele
}

// Prefiltr produktów (kod): port `kandydaci` z prototypu.
// Scouty 17.11: linie liczone WSZYSTKIE naraz (nie pierwsza trafiona) – „Titan Guard RC2” wpadał w Alu extra RC2 przez słowo „rc2”,
// „Bastion A-104, ościeżnica drewniana” w Wood extra przez „drewnian”, a dwie pary drzwi (Alu extra + Steel Extra) dostawały
// kandydatów tylko z jednej linii. Titan i Bastion mają własne wzory modeli (G-05, A-104), punktowane jak Otto/Libre.
const LINIE: [string, string[]][] = [
  ['titan', ['titan']],
  ['bastion', ['bastion']],
  ['alu extra rc2', ['alu extra rc2', 'rc2']],
  ['alu extra', ['alu extra', 'alu+', 'alu plus']],
  ['wood extra', ['wood extra', 'wood', 'drewnian']],
  ['steel extra', ['steel extra', 'steel', 'stal']],
  ['systemie alu', ['alu']],
]

export function kandydaci(produkty: Kandydat[], analiza: Analiza, limit = 8): Kandydat[] {
  // 28.11 / runda 7: produkt wskazany przez handlowca numerem (ID) albo linkiem do sklepu — zawsze na pierwszym miejscu,
  // także dla drzwi wewnętrznych i produktów z „wewnętrzne” w nazwie
  const d0 = analiza.dane ?? {}
  const tekstWsk = [d0.system, d0.model, d0.wariant_panelu, d0.okucia, d0.inne, analiza.potrzeba, analiza.poprawka_handlowca, analiza.odpowiedzi_handlowca]
    .map((x) => String(x ?? '')).join(' ').toLowerCase()
  const wsk = wskazaneProdukty(produkty, tekstWsk)
  const reszta = kandydaciWgOpisu(produkty, analiza, limit)
  if (!wsk.length) return reszta
  const ids = new Set(wsk.map((p) => p.id))
  return [...wsk, ...reszta.filter((p) => !ids.has(p.id))].slice(0, Math.max(limit, wsk.length))
}

function kandydaciWgOpisu(produkty: Kandydat[], analiza: Analiza, limit = 8): Kandydat[] {
  const d = analiza.dane ?? {}
  // 27.11 (Otto 49 + Libre 31, FHU KATO v12): „pochwyt Stilo 170 …” siedział tylko w `okucia` — bez tego pola produkty „z pochwytem”
  // dostawały karę i Otto 49 z pochwytem (#65452) wypadał z listy, a dobór brał zwykły Otto 49 (#31052)
  let tekst = ['system', 'model', 'wariant_panelu', 'okucia', 'inne'].map((k) => String(d[k] ?? '')).join(' ').toLowerCase()
  tekst += ' ' + (analiza.potrzeba ?? '').toLowerCase()
  // 24.11: to, co handlowiec dopisał (poprawka ustaleń, odpowiedzi na pytania systemu), też szuka linii i wzoru
  tekst += ' ' + String(analiza.poprawka_handlowca ?? '').toLowerCase() + ' ' + String(analiza.odpowiedzi_handlowca ?? '').toLowerCase()
  // słowo kluczowe musi zaczynać wyraz: „ustalenia” zawierało „stal” i każde zapytanie dostawało Steel Extra (zgł. #148/#149, 16.11)
  const maSlowo = (s: string) => new RegExp('(^|[^\\p{L}])' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u').test(tekst)
  let linie = LINIE.filter(([, slowa]) => slowa.some(maSlowo)).map(([l]) => l)
  // kategoria z analizy rozmowy wskazuje linię, nawet gdy w tekście nie padła jej nazwa
  const kat = String(analiza.kategoria ?? '').toLowerCase()
  if ((kat === 'titan' || kat === 'bastion') && !linie.includes(kat)) linie.push(kat)
  // drzwi wewnętrzne (zgł. #152/#154, 16.11): inne nazwy produktów, inne słowa kluczowe – osobny prefiltr.
  // 24.11 (Perzanowski): kategoria z analizy ma pierwszeństwo przed słowem „wewnętrzne” w tekście — klient chciał drzwi wejściowe Bastion
  // i „do tego drzwi wewnętrzne z magazynu”, a samo słowo przełączało cały dobór na drzwi wewnętrzne i model nie widział Bastionów.
  const katZewn = kat !== '' && kat !== 'wewnetrzne' && kat !== 'nieznana' && kat !== 'inne'
  if (kat === 'wewnetrzne' || (!katZewn && !linie.length && /wewn[eę]trzn/.test(tekst) && !/zewn[eę]trzn/.test(tekst))) return kandydaciWewnetrzne(produkty, analiza, tekst, limit)
  // „rc2” przy Titanie/Bastionie to klasa antywłamaniowa drzwi do mieszkania, nie system Alu extra RC2; „drewnian” to ościeżnica Bastiona
  if (linie.includes('titan') || linie.includes('bastion')) linie = linie.filter((l) => l === 'titan' || l === 'bastion' || maSlowo(l))
  // „alu” zawiera się w „alu extra”, a „alu extra” w „alu extra rc2”: zostaje najbardziej szczegółowa z wymienionych linii Alu
  if (linie.includes('alu extra rc2')) linie = linie.filter((l) => l !== 'alu extra' && l !== 'systemie alu')
  else if (linie.includes('alu extra')) linie = linie.filter((l) => l !== 'systemie alu')
  const model = String(d.model ?? '').toLowerCase()
  // wzory: Otto/Libre NN(litera), Titan G-NN, Bastion A-NNN / B-NNN (z myślnikiem lub bez) – wszystkie wystąpienia w modelu i tekście
  const re = new RegExp(`\\b(otto|libre)\\s*(\\d+)\\s*([a-z]?)\\b|\\b(g)-?(\\d{2})\\b|${BASTION_WZOR.source}`, 'g')
  const modele: { wz: string; nr: string; lit: string }[] = []
  for (const src of [model, tekst]) for (const mm of src.matchAll(re)) {
    const wz = (mm[1] ?? mm[4] ?? mm[6]) as string, nr = (mm[2] ?? mm[5] ?? mm[7]) as string, lit = mm[3] ?? ''
    if (!modele.some((x) => x.wz === wz && x.nr === nr)) modele.push({ wz, nr, lit })
  }
  const wariant = String(d.wariant_panelu ?? '').toLowerCase()
  const pochwyt = tekst.includes('pochwyt')
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wyniki: [number, Kandydat][] = []
  // dokładne trafienie wzoru (indeks w `modele`) — do gwarancji miejsc na liście przy kilku wzorach w jednej ofercie
  const trafienie = new Map<number, number>()
  for (const p of produkty) {
    const n = p.nazwa.toLowerCase()
    if (!n.includes('drzwi') || n.includes('wewnętrzne')) continue   // wewnętrzne mają własny prefiltr
    let s = 0
    let sLinia = 0
    for (const linia of linie) {
      if (linia === 'systemie alu') { if (/systemie alu\b/.test(n) && !n.includes('extra')) sLinia = Math.max(sLinia, 5) }
      else if (n.includes(linia)) sLinia = Math.max(sLinia, linia === 'alu extra' && n.includes('rc2') && !linie.includes('alu extra rc2') ? 2 : 5)
    }
    s += sLinia
    let sModel = 0
    for (const [mi, { wz, nr, lit }] of modele.entries()) {
      const sep = wz === 'otto' || wz === 'libre' ? '\\s*' : '-?'
      if (new RegExp(`\\b${esc(wz)}${sep}${nr}${esc(lit)}\\b`).test(n)) { sModel = Math.max(sModel, 6); if (!trafienie.has(p.id)) trafienie.set(p.id, mi) }
      else if (new RegExp(`\\b${esc(wz)}${sep}${nr}\\w*`).test(n)) sModel = Math.max(sModel, 3)
      else if (wz.length > 1 && n.includes(wz)) sModel = Math.max(sModel, 1)
    }
    s += sModel
    if (wariant.includes('noir') || wariant.includes('czarn')) s += n.includes('noir matt') ? 2 : -1
    else if (wariant.includes('gold') || wariant.includes('złot')) s += n.includes('gold') ? 2 : -1
    else if (wariant) s += (!n.includes('noir') && !n.includes('gold')) ? 1 : -1
    if (pochwyt !== n.includes('pochwyt')) s -= 2
    if (s > 0) wyniki.push([s, p])
  }
  wyniki.sort((a, b) => b[0] - a[0] || a[1].id - b[1].id)
  // 27.11: kilka wzorów w jednej ofercie (Otto 49 + Libre 31) — warianty jednego (Libre: zwykły, Noir, Noir Matt, RC2, z pochwytem…)
  // zajmowały całą ósemkę. Każdy wymieniony wzór ma zagwarantowane 3 najlepsze dokładne trafienia, resztę miejsc wg punktów.
  if (modele.length < 2) return wyniki.slice(0, limit).map(([, p]) => p)
  const pewne = new Set<number>()
  modele.forEach((_, mi) => wyniki.filter(([, p]) => trafienie.get(p.id) === mi).slice(0, 3).forEach(([, p]) => pewne.add(p.id)))
  const out = wyniki.filter(([, p]) => pewne.has(p.id))
  for (const w of wyniki) {
    if (out.length >= Math.max(limit, pewne.size)) break
    if (!pewne.has(w[1].id)) out.push(w)
  }
  out.sort((a, b) => b[0] - a[0] || a[1].id - b[1].id)
  return out.map(([, p]) => p)
}

/** Prefiltr drzwi wewnętrznych: nazwy w sklepie to „Drzwi wewnętrzne ramiakowe przylgowe – Virello”, „Drzwi wewnętrzne akustyczne Bastion Interior STD-01…”,
 *  „Drzwi wewnętrzne VIVENTO …”, „⭐️Dostępne od ręki!⭐️ Drzwi wewnętrzne …”. Wzór (Virello 02) jest zwykle opcją, więc liczy się kolekcja. */
function kandydaciWewnetrzne(produkty: Kandydat[], analiza: Analiza, tekst: string, limit = 8): Kandydat[] {
  const norm = (s: string) => s.toLowerCase().replace(/<br\s*\/?>/g, ' ').replace(/[–\-_/]+/g, ' ').replace(/\s+/g, ' ').trim()
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const t = norm(tekst)
  const model = norm(String(analiza.dane?.model ?? ''))
  const kolekcja = model.split(' ').find((w) => w.length >= 3 && /^\p{L}+$/u.test(w)) ?? ''
  const interior = /\binterior\b/.test(t)
  const przesuwne = /przesuwn/.test(t)
  const bezprzylg = /bezprzylg/.test(t)
  const odReki = /od r[eę]ki/.test(t)
  // właściciel 17.11: drzwi wewnętrzne ofertujemy w wariancie „Dostępne od ręki”, gdy kolekcja go ma – produkt od ręki ma być w 3 najlepszych (ze spisem pól)
  const produktOdReki = (n: string) => /od r[eę]ki/.test(n)
  const cechy: [RegExp, string][] = [[/bia[łl]/, 'biał'], [/szkl|szyb|przeszkl/, 'szkl'], [/ramiak/, 'ramiak'], [/p[łl]ytow/, 'płytow'], [/akustycz/, 'akustycz'], [/vivento/, 'vivento']]
  const wyniki: [number, Kandydat][] = []
  for (const p of produkty) {
    const n = norm(p.nazwa)
    if (!n.includes('drzwi wewnętrzne')) continue
    let s = 1
    if (model && n.includes(model)) s += 8                                          // „std 01” w „bastion interior std 01”
    else if (kolekcja && new RegExp(`\\b${esc(kolekcja)}\\b`, 'u').test(n)) s += 5    // „virello”
    if (interior) s += n.includes('interior') ? 5 : -4
    else if (n.includes('interior') && !(model && n.includes(model))) s -= 2
    if (przesuwne !== n.includes('przesuwn')) s -= 3
    else if (przesuwne) s += 2
    if (bezprzylg) s += n.includes('bezprzylg') ? 2 : -1
    else if (n.includes('bezprzylg')) s -= 1
    if (produktOdReki(n)) s += odReki ? 4 : 3
    for (const [re, slowo] of cechy) if (re.test(t) && n.includes(slowo)) s += 1
    if (s > 0) wyniki.push([s, p])
  }
  wyniki.sort((a, b) => b[0] - a[0] || a[1].id - b[1].id)
  return wyniki.slice(0, limit).map(([, p]) => p)
}
