// Prompt i schemat analizy rozmowy. To ten sam schemat, co SCHEMA_ANALIZA w oferta/prototyp.py:
// funkcja ofert dostaje gotową analizę z crm.rozmowy.analiza i nie analizuje rozmowy drugi raz.
// Zmieniasz tutaj = zmień też w prototypie (albo odwrotnie).

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

/** Zasada właściciela (2026-11-15): klient z montażem z woj. śląskiego dostaje wstępną ofertę i pomiar, nie pytania o wymiary. */
export const ZASADA_POMIARU = `Zasada firmy (montaż na Śląsku): jeśli klient chce montażu od nas i jest z województwa śląskiego (np. Rybnik, Żory, Wodzisław, Jastrzębie, Katowice, Gliwice, Tychy, Siemianowice, Sosnowiec, Bielsko-Biała, Częstochowa, Racibórz, Mikołów i okolice), to wymiar otworu, rozmiar skrzydła, kierunek otwierania, rodzaj ościeżnicy ani zdjęcia otworu NIE są brakami blokującymi: przygotowujemy wstępną ofertę na podstawie tego, czego klient szuka, i umawiamy pomiar u klienta (to nasza robota). Wtedy: tych pozycji NIE wpisuj do \`brakuje\`; jeśli wiadomo przynajmniej, jakiego rodzaju drzwi klient chce, \`nastepna_akcja\` = przygotuj_oferte (nie dopytaj); do \`ustalenia_z_rozmowy\` dopisz „umówić pomiar”. Dopytaj zostaje tylko, gdy nie wiadomo nawet, jakie drzwi (rodzaj/wzór) albo nie ma jak się skontaktować.`

export const SCHEMA_ANALIZA = {
  type: 'object',
  properties: {
    typ: { type: 'string', enum: ['zapytanie', 'klient', 'status', 'reklamacja', 'dostawca', 'spam', 'inne'],
      description: 'zapytanie = nowy klient pyta o drzwi; klient = ktoś, kto już ma ofertę lub zamówienie, wraca w sprawie sprzedaży; status = pyta tylko o status zamówienia/dostawy; reklamacja; dostawca = telefon handlowy/firmowy do nas; spam; inne' },
    nazwa: { type: 'string', description: 'Samo nazwisko lub nazwa firmy, bez komentarzy' },
    miejscowosc: { type: 'string', description: 'Sama miejscowość, np. Rybnik, bez nawiasów i dopisków' },
    email: { type: 'string' },
    telefon: { type: 'string', description: 'Tylko jeśli klient podał w rozmowie inny numer niż ten, z którego dzwoni' },
    kategoria: { type: 'string', enum: ['zewnetrzne', 'wewnetrzne', 'titan', 'bastion', 'alu', 'inne', 'nieznana'],
      description: 'zewnetrzne = drzwi zewnętrzne do domu, W TYM systemy KR Center Steel Extra, Alu, Alu extra, Alu extra RC2, Wood extra (Otto, Libre); '
        + 'wewnetrzne = drzwi pokojowe/wewnętrzne; titan = Bastion Titan; bastion = Bastion A/B do mieszkania; '
        + 'alu = WYŁĄCZNIE stolarka aluminiowa (okna, witryny, fasady, drzwi aluminiowe spoza oferty KR Center), NIGDY drzwi w systemie Alu/Alu extra; inne; nieznana' },
    potrzeba: { type: 'string' },
    dane: {
      type: 'object',
      properties: {
        system: { type: 'string', description: 'Sama nazwa systemu, np. Alu extra, bez opisu w nawiasie' },
        model: { type: 'string', description: 'Sam wzór, np. Otto 41' },
        wariant_panelu: { type: 'string', description: 'Np. Noir Matt albo Gold, bez tłumaczeń w nawiasie' },
        kolor_skrzydla: { type: 'string' },
        rozmiar: { type: 'string' },
        wymiar_otworu: { type: 'string' },
        kierunek: { type: 'string' },
        sposob_otwierania: { type: 'string' },
        przeszklenie: { type: 'string' },
        okucia: { type: 'string' },
        oslonki: { type: 'string' },
        montaz: { type: 'string' },
        dostawa: { type: 'string', enum: ['kurier', 'odbior_osobisty', ''],
          description: 'kurier, gdy mowa o wysyłce, dostawie, kurierze, przysłaniu; odbior_osobisty, gdy klient sam odbierze/przyjedzie; pusty, gdy nie padło' },
        ilosc: { type: 'integer', description: '1, jeśli nie padło inaczej' },
        termin: { type: 'string' },
        inne: { type: 'string' },
      },
      required: ['system', 'model', 'wariant_panelu', 'kolor_skrzydla', 'rozmiar', 'wymiar_otworu', 'kierunek',
        'sposob_otwierania', 'przeszklenie', 'okucia', 'oslonki', 'montaz', 'dostawa', 'ilosc', 'termin', 'inne'],
      additionalProperties: false,
    },
    brakuje: { type: 'array', items: { type: 'string' },
      description: 'Dane kluczowe, których brakuje do wyceny/zamówienia. Przy montażu na Śląsku wymiary, kierunek, ościeżnica i zdjęcia NIE są brakami (ustalamy na pomiarze)' },
    ustalenia_z_rozmowy: { type: 'array', items: { type: 'string' },
      description: 'Konkretne obietnice i prośby klienta, do których mail ma nawiązać' },
    podsumowanie: { type: 'string', description: '2–3 zdania dla handlowca' },
    nastepna_akcja: { type: 'string', enum: ['dopytaj', 'przygotuj_oferte', 'follow_up', 'brak'],
      description: 'Zadania „oddzwoń” nie ma (24.11): gdy klient prosi o kontakt albo oddzwonienie, wybierz dopytaj. przygotuj_oferte tylko, gdy wiadomo przynajmniej jaki rodzaj drzwi i klient chce wyceny (przy montażu na Śląsku także bez wymiarów: robimy wstępną ofertę i pomiar); dopytaj TYLKO, gdy klient chce iść dalej (prosi o wycenę, termin, kontakt), a do tego brakuje danych kluczowych, których sam nie obiecał podesłać; follow_up, gdy klient ma już ofertę i trzeba wrócić po decyzję; brak dla statusów, dostawców, spamu ORAZ dla rozmów czysto informacyjnych: klient tylko pytał, nie zostawił danych, nie prosił o ofertę ani kontakt, albo szuka czegoś, czego nie mamy (np. pomiar i montaż poza Śląskiem bez chęci zakupu wysyłkowego, produkt spoza oferty) — wtedy brak, a w podsumowaniu napisz, czego szukał' },
    rodzaj_klienta: { type: 'string', enum: ['indywidualny', 'firma', 'inwestycja', ''],
      description: 'indywidualny = osoba prywatna do własnego domu/mieszkania; firma = działalność kupuje do swojej siedziby/lokalu; inwestycja = deweloper, wspólnota, generalny wykonawca, budynek wielorodzinny lub kilka sztuk do jednej budowy; pusty, gdy nie wiadomo' },
  },
  required: ['typ', 'nazwa', 'miejscowosc', 'email', 'telefon', 'kategoria', 'potrzeba', 'dane', 'brakuje',
    'ustalenia_z_rozmowy', 'podsumowanie', 'nastepna_akcja', 'rodzaj_klienta'],
  additionalProperties: false,
} as const

export type Analiza = {
  typ: 'zapytanie' | 'klient' | 'status' | 'reklamacja' | 'dostawca' | 'spam' | 'inne'
  nazwa: string; miejscowosc: string; email: string; telefon: string
  kategoria: string; potrzeba: string
  dane: Record<string, string | number>
  brakuje: string[]; ustalenia_z_rozmowy: string[]
  podsumowanie: string
  nastepna_akcja: 'oddzwon' | 'dopytaj' | 'przygotuj_oferte' | 'follow_up' | 'brak'
  rodzaj_klienta: 'indywidualny' | 'firma' | 'inwestycja' | ''
}

export type KontekstRozmowy = {
  kierunek: string
  ivr: string | null
  czas_s: number
  lead: { nazwa: string | null; miejscowosc: string | null; status: string; kategoria: string | null; podsumowanie: string | null; nastepna_akcja: string | null } | null
  poprzednie: { data: string; podsumowanie: string | null; typ: string | null }[]
}

export function systemAnalizy(): string {
  return 'Jesteś asystentem sprzedaży Po Drzwi (sprzedaż i montaż drzwi, Śląsk). Analizujesz transkrypcję rozmowy '
    + 'telefonicznej handlowca (Magdalena) z klientem i wyciągasz z niej dane do CRM i do oferty. Odpowiadasz wyłącznie JSON-em wg schematu. '
    + 'Zasady: zapisuj tylko to, co padło w rozmowie; czego nie ustalono, zostaw pusty tekst (kategoria: nieznana) i wpisz do `brakuje`; '
    + 'nie zgaduj wymiaru otworu z rozmiaru skrzydła; `ustalenia_z_rozmowy` to konkretne obietnice handlowca i prośby '
    + 'klienta (np. „klient zmierzy otwór i podeśle”, „prosi o termin ważności ceny”). '
    + 'Transkrypcja jest automatyczna, mówcy są oznaczeni numerami: sam rozpoznaj, kto jest handlowcem, a kto klientem. '
    + 'Wybór w menu IVR „2” oznacza „zamówienia i reklamacje”, czyli najpewniej obecny klient lub reklamacja, nie nowe zapytanie. '
    + 'Jeśli dzwoni osoba, którą już mamy w bazie (kontekst poniżej), typ to raczej `klient`, a akcja zależy od tego, na czym stanęła rozmowa. '
    + 'Nie wymyślaj zadań: rozmowa, w której klient tylko się dopytywał i rozłączył się bez prośby o ofertę, termin czy kontakt, kończy się akcją `brak` — handlowiec nie ma do kogo i o co dzwonić. `dopytaj` jest dla klienta, który chce kupić, ale czegoś nie podał. '
    + '`rodzaj_klienta`: indywidualny / firma / inwestycja wg tego, co padło (deweloper, wspólnota, wykonawca, kilka sztuk do jednej budowy = inwestycja); pusty, gdy nie wiadomo. '
    + 'W `dane.montaz` wpisz, czy klient chce montażu od nas (np. „z montażem”, „bez montażu, sam zamontuje”).\n\n'
    + ZASADA_POMIARU + '\n\n' + SLOWNIK
}

export function userAnalizy(transkrypcja: string, k: KontekstRozmowy): string {
  const czesci = [
    `Rozmowa ${k.kierunek}, czas ${k.czas_s} s, wybór IVR: ${k.ivr ?? 'brak'}.`,
  ]
  if (k.lead) {
    czesci.push('Ten numer już jest w bazie: ' + JSON.stringify(k.lead))
  } else {
    czesci.push('Numer nie występuje w bazie (nowy kontakt).')
  }
  if (k.poprzednie.length) {
    czesci.push('Poprzednie rozmowy z tym numerem:\n' + k.poprzednie.map((p) => `- ${p.data.slice(0, 10)} (${p.typ ?? '?'}): ${p.podsumowanie ?? 'bez podsumowania'}`).join('\n'))
  }
  czesci.push(`Transkrypcja rozmowy:\n\n${transkrypcja}`)
  return czesci.join('\n\n')
}

// ---------------------------------------------------------------- mail przychodzący (ten sam schemat, inny kontekst)
export type KontekstMaila = {
  od: string
  kanal: 'mail' | 'formularz'
  do: string[]
  temat: string
  data: string
  zalaczniki: string[]
  tresc_ucieta: boolean
  lead: { nazwa: string | null; miejscowosc: string | null; status: string; kategoria: string | null; podsumowanie: string | null; nastepna_akcja: string | null } | null
  poprzednie: { data: string; rodzaj: string; podsumowanie: string | null; typ: string | null }[]
  oferta: { id: string; wersja: number; status: string; cena_razem: number | null; dostawa_koszt: number | null; temat: string | null; wyslano_at: string | null; produkt: string | null; odpowiedz_na_nia: boolean } | null
}

export function systemAnalizyMaila(): string {
  return 'Jesteś asystentem sprzedaży Po Drzwi (sprzedaż i montaż drzwi, Śląsk). Analizujesz mail, który przyszedł na skrzynkę firmy '
    + '(kontakt@podrzwi.pl albo skrzynkę handlowca), i wyciągasz z niego dane do CRM i do oferty. Odpowiadasz wyłącznie JSON-em wg schematu. '
    + 'Zasady: zapisuj tylko to, co jest w mailu; czego nie ustalono, zostaw pusty tekst (kategoria: nieznana) i wpisz do `brakuje`; '
    + 'nie zgaduj wymiaru otworu z rozmiaru skrzydła. `ustalenia_z_rozmowy` to konkretne prośby klienta i rzeczy, do których odpowiedź ma nawiązać '
    + '(np. „prosi o wycenę z montażem”, „pyta o termin”, „załączył zdjęcie otworu”). `nazwa` to nazwisko/firma z podpisu lub pola Od. '
    + '`telefon` to numer podany w treści lub podpisie. `email` zostaw pusty (znamy adres nadawcy), chyba że klient prosi o kontakt na inny adres. '
    + 'Typy: zapytanie = nowy klient pyta o drzwi/wycenę; klient = osoba, którą już mamy w bazie (kontekst poniżej) albo odpowiada na naszą ofertę '
    + '(akceptuje, negocjuje, dopytuje, prosi o zmianę); status = pyta tylko o status zamówienia/dostawy/zwrotu; reklamacja = usterka, uszkodzenie, '
    + 'niezgodność; dostawca = oferta handlowa, faktura, firma do nas; spam = reklama, phishing; inne = nie pasuje nigdzie. '
    + 'Akcje: przygotuj_oferte, gdy wiadomo przynajmniej jaki rodzaj drzwi i klient chce wyceny; dopytaj, gdy brakuje danych kluczowych '
    + 'i trzeba o nie zapytać mailem, a także gdy klient wprost prosi o telefon (zadania „oddzwoń” nie ma); follow_up, gdy klient odpisał na ofertę '
    + 'i trzeba mu odpowiedzieć lub domknąć sprzedaż; brak dla statusów, dostawców, spamu i innych. '
    + 'Mail może zawierać pod spodem cytowaną wcześniejszą korespondencję: analizuj to, co klient napisał teraz, a cytat traktuj jako kontekst. '
    + 'Zdjęcia i PDF-y w załącznikach widzisz tylko z nazwy: jeśli klient pisze, że wysyła wymiary/zdjęcia, zapisz to w ustaleniach, nie zgaduj ich treści. '
    + '`rodzaj_klienta`: indywidualny / firma / inwestycja wg treści i stopki (deweloper, wspólnota, wykonawca, kilka sztuk do jednej budowy = inwestycja); pusty, gdy nie wiadomo. '
    + 'W `dane.montaz` wpisz, czy klient chce montażu od nas.\n\n'
    + ZASADA_POMIARU + '\n\n' + SLOWNIK
}

export function userAnalizyMaila(tresc: string, k: KontekstMaila): string {
  const czesci = [
    (k.kanal === 'formularz' ? 'To zgłoszenie z formularza kontaktowego na podrzwi.pl (pola formularza są w treści; adres i nazwisko klienta z formularza).\n' : '')
      + `Mail od: ${k.od}\nDo: ${k.do.join(', ') || '?'}\nTemat: ${k.temat || '(bez tematu)'}\nData: ${k.data || '?'}`
      + (k.zalaczniki.length ? `\nZałączniki: ${k.zalaczniki.join(', ')}` : '')
      + (k.tresc_ucieta ? '\n(Treść była bardzo długa i została ucięta.)' : ''),
  ]
  if (k.lead) czesci.push('Nadawca już jest w bazie: ' + JSON.stringify(k.lead))
  else czesci.push('Adres nadawcy nie występuje w bazie (nowy kontakt).')
  if (k.oferta) {
    const cena = k.oferta.cena_razem != null ? `${Math.round(Number(k.oferta.cena_razem) + Number(k.oferta.dostawa_koszt ?? 0))} zł brutto z dostawą` : 'cena nieznana'
    czesci.push(`${k.oferta.odpowiedz_na_nia ? 'To jest odpowiedź na naszą ofertę' : 'Klient ma u nas ofertę'} v${k.oferta.wersja} (status ${k.oferta.status}, ${cena}`
      + `${k.oferta.produkt ? `, produkt: ${k.oferta.produkt}` : ''}${k.oferta.temat ? `, temat: „${k.oferta.temat}”` : ''}${k.oferta.wyslano_at ? `, wysłana ${k.oferta.wyslano_at.slice(0, 10)}` : ''}).`)
  }
  if (k.poprzednie.length) {
    czesci.push('Wcześniejszy kontakt z tą osobą:\n' + k.poprzednie.map((p) => `- ${p.data.slice(0, 10)} ${p.rodzaj} (${p.typ ?? '?'}): ${p.podsumowanie ?? 'bez podsumowania'}`).join('\n'))
  }
  czesci.push(`Treść maila:\n\n${tresc || '(pusta treść)'}`)
  return czesci.join('\n\n')
}

// ---------------------------------------------------------------- notatka handlowca (ten sam schemat, inny kontekst)
// Klient z salonu (walk-in) albo rozmowa poza Ringostatem: handlowiec wpisuje skrótową notatkę i zleca ofertę.
export type KontekstNotatki = {
  zrodlo: string | null
  lead: { nazwa: string | null; miejscowosc: string | null; telefon: string | null; email: string | null; status: string; kategoria: string | null }
  poprzednie: { data: string; rodzaj: string; podsumowanie: string | null; typ: string | null }[]
  oferta: { wersja: number; status: string; cena_razem: number | null; dostawa_koszt: number | null; produkt: string | null } | null
}

export function systemAnalizyNotatki(): string {
  return 'Jesteś asystentem sprzedaży Po Drzwi (sprzedaż i montaż drzwi, Śląsk). Analizujesz NOTATKĘ HANDLOWCA (nie wypowiedź klienta), '
    + 'spisaną po rozmowie z klientem w salonie albo poza systemem telefonicznym, i zamieniasz ją na dane do oferty. '
    + 'Odpowiadasz wyłącznie JSON-em wg schematu. Notatka jest skrótowa, w żargonie branżowym, często bez pełnych zdań: '
    + 'rozwijaj skróty wg słownika (np. „Libre 33B NM lewe 90 na zewnątrz lustro klamka czarna osłonki kurier” = wzór Libre 33B, '
    + 'panel Noir Matt, kierunek lewe, rozmiar 90, otwierane na zewnątrz, przeszklenie lustro weneckie, okucia czarne, '
    + 'osłonki na zawiasy, dostawa kurierem). Zasady: zapisuj to, co jest w notatce; czego nie ma, zostaw pusty tekst '
    + '(kategoria: nieznana) i wpisz do `brakuje`; nie zgaduj wymiaru otworu z rozmiaru skrzydła. '
    + 'Handlowiec zlecił przygotowanie oferty, więc `nastepna_akcja` = przygotuj_oferte; tylko gdy z notatki nie da się ustalić nawet '
    + 'rodzaju drzwi, daj dopytaj. `typ`: klient, jeśli osoba ma już u nas ofertę lub zamówienie (kontekst poniżej), inaczej zapytanie. '
    + '`ustalenia_z_rozmowy`: to, co handlowiec ustalił z klientem i do czego mail ma nawiązać (np. wizyta w salonie, obejrzany wzór, '
    + 'obiecany pomiar, termin). `nazwa`, `miejscowosc`, `email`, `telefon`: tylko jeśli są w notatce (dane klienta z bazy już znamy). '
    + '`rodzaj_klienta`: indywidualny / firma / inwestycja wg notatki; pusty, gdy nie wiadomo. '
    + 'W `dane.montaz` wpisz, czy klient chce montażu od nas.\n\n'
    + ZASADA_POMIARU + '\n\n' + SLOWNIK
}

export function userAnalizyNotatki(notatka: string, k: KontekstNotatki): string {
  const czesci = [
    (k.zrodlo === 'wizyta' ? 'Klient przyszedł do salonu Po Drzwi i rozmawiał z handlowcem osobiście.' : 'Handlowiec rozmawiał z klientem poza systemem telefonicznym.')
      + ' Dane klienta z bazy: ' + JSON.stringify(k.lead),
  ]
  if (k.oferta) {
    const cena = k.oferta.cena_razem != null ? `${Math.round(Number(k.oferta.cena_razem) + Number(k.oferta.dostawa_koszt ?? 0))} zł brutto z dostawą` : 'cena nieznana'
    czesci.push(`Klient ma u nas ofertę v${k.oferta.wersja} (status ${k.oferta.status}, ${cena}${k.oferta.produkt ? `, produkt: ${k.oferta.produkt}` : ''}).`)
  }
  if (k.poprzednie.length) {
    czesci.push('Wcześniejszy kontakt z tą osobą:\n' + k.poprzednie.map((p) => `- ${p.data.slice(0, 10)} ${p.rodzaj} (${p.typ ?? '?'}): ${p.podsumowanie ?? 'bez podsumowania'}`).join('\n'))
  }
  czesci.push(`Notatka handlowca:\n\n${notatka}`)
  return czesci.join('\n\n')
}
