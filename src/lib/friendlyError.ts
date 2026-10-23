// Tłumaczenie technicznych błędów (Postgres / PostgREST / sieć) na ludzki polski.
// Wołane przy WYŚWIETLANIU toastu błędu — obejmuje wszystkie miejsca typu
// pushToast(`Błąd: ${error.message}`) bez ruszania każdego z osobna.
// Prefiks komunikatu (np. „Nie zapisano odbioru:”) zostaje, podmieniany jest
// tylko techniczny ogon. Nasze własne komunikaty z bazy (RAISE po polsku) nie
// pasują do żadnego wzorca, więc przechodzą bez zmian.

type Rule = { re: RegExp; text: (m: RegExpMatchArray) => string }

const RULES: Rule[] = [
  {
    re: /duplicate key value violates unique constraint/i,
    text: () => 'taki wpis już istnieje (duplikat) — odśwież listę, ktoś mógł go właśnie dodać',
  },
  {
    re: /update or delete on table "[^"]*" violates foreign key constraint/i,
    text: () => 'nie można usunąć — inne dane się do tego odwołują',
  },
  {
    re: /insert or update on table "[^"]*" violates foreign key constraint/i,
    text: () => 'powiązany rekord nie istnieje (mógł zostać usunięty) — odśwież i spróbuj ponownie',
  },
  {
    re: /(?:new row violates )?row-level security|permission denied|insufficient_privilege/i,
    text: () => 'brak uprawnień do tej operacji',
  },
  {
    re: /null value in column "([^"]+)"[^]*not-null constraint/i,
    text: (m) => `brakuje wymaganej wartości (pole ${m[1]})`,
  },
  {
    re: /violates check constraint "([^"]+)"/i,
    text: (m) => `niedozwolona wartość (reguła ${m[1]})`,
  },
  { re: /value too long for type/i, text: () => 'za długi tekst w którymś polu' },
  {
    re: /invalid input syntax for type (integer|bigint|numeric|smallint|double precision|real)/i,
    text: () => 'w polu liczbowym jest coś, co nie jest liczbą',
  },
  { re: /invalid input syntax for type (date|timestamp[^"]*)/i, text: () => 'nieprawidłowa data' },
  { re: /invalid input syntax for type uuid/i, text: () => 'nieprawidłowy identyfikator' },
  {
    re: /canceling statement due to statement timeout/i,
    text: () => 'serwer nie zdążył w limicie czasu — spróbuj ponownie za chwilę',
  },
  {
    re: /deadlock detected|could not serialize access/i,
    text: () => 'konflikt z równoczesną zmianą kogoś innego — spróbuj ponownie',
  },
  { re: /JWT expired|invalid JWT|jwt malformed/i, text: () => 'sesja wygasła — zaloguj się ponownie' },
  {
    re: /Failed to fetch|NetworkError|Load failed|fetch failed|ERR_INTERNET_DISCONNECTED|network request failed/i,
    text: () => 'brak połączenia z serwerem — sprawdź internet',
  },
  {
    re: /too many requests|rate limit/i,
    text: () => 'za dużo żądań naraz — odczekaj chwilę i spróbuj ponownie',
  },
  {
    re: /JSON object requested, multiple \(or no\) rows returned|PGRST116/i,
    text: () => 'nie znaleziono rekordu (mógł zostać usunięty) — odśwież listę',
  },
  {
    re: /Could not find the (function|table|column)[^]*schema cache/i,
    text: () => 'serwer nie zna tej operacji — zaktualizuj aplikację (albo zgłoś administratorowi)',
  },
]

// Polska dalsza część komunikatu po technicznym błędzie (np. „… . PDF NIE został
// wygenerowany — spróbuj ponownie.”) — zdanie z polskimi znakami; surowe błędy
// Postgresa są po angielsku, więc ich nie złapie.
const POLISH_TAIL = /[.!]\s+(?=[^.]*[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ])/

/** Zwraca komunikat z technicznym ogonem przetłumaczonym na polski (albo bez zmian). */
export function humanizeErrorText(message: string): string {
  for (const rule of RULES) {
    const m = message.match(rule.re)
    if (!m || m.index === undefined) continue
    const prefix = message.slice(0, m.index).replace(/[\s:–—-]+$/, '')
    const rest = message.slice(m.index)
    const tailAt = rest.search(POLISH_TAIL)
    const tail = tailAt >= 0 ? rest.slice(tailAt).replace(/^[.!]\s+/, '') : ''
    const text = rule.text(m)
    const head = prefix ? `${prefix}: ${text}` : text.charAt(0).toUpperCase() + text.slice(1)
    return tail ? `${head}. ${tail}` : head
  }
  return message
}
