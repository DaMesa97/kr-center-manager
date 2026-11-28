// D53: PIN podpisu etapu ZKP — reguły formy jak w bazie (zkp_pin_problem, migracja 20261128035300).
// PIN sprawdza i przechowuje (hash bcrypt) wyłącznie baza; tu tylko podpowiedź przed wysłaniem.

/** null = PIN poprawny w formie; inaczej komunikat dla pracownika. */
/** 28.11 (właściciel: „PIN ZKP na razie wyjeb”): przyciski PIN schowane; baza wymaga PIN-u tylko przy
 *  integration_settings.zkp_pin_wymagany = on (migracja 20261128041000). Włączenie: oba przełączniki. */
export const ZKP_PIN_WLACZONY = false

export function zkpPinProblem(pin: string): string | null {
  if (!/^[0-9]{4,8}$/.test(pin)) return 'PIN: od 4 do 8 cyfr'
  if (/^(.)\1*$/.test(pin)) return 'PIN nie może być jedną powtórzoną cyfrą'
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'PIN nie może być kolejnymi cyframi (np. 1234)'
  return null
}

/** Błąd bazy bez migracji PIN-u (brak funkcji) → czytelny komunikat. */
export function zkpPinRpcErrorText(error: { code?: string | null; message: string }): string {
  if (error.code === 'PGRST202' || error.code === '42883') {
    return 'PIN podpisu ZKP nie jest jeszcze dostępny — baza czeka na aktualizację (D53)'
  }
  return error.message
}

/**
 * Ustawienie PIN-u krok po kroku (obecny PIN — gdy wymagany, nowy, powtórzenie). Okienka i zapis
 * podaje ekran (komputer: appPrompt, telefon: okienko PIN). true = zapisano.
 */
export async function zkpPinSetupFlow(opts: {
  needCurrent: boolean
  whose: string
  ask: (message: string, title: string) => Promise<string | null>
  save: (newPin: string, currentPin: string | null) => Promise<string | null>
  notify: (message: string, ok: boolean) => void | Promise<void>
}): Promise<boolean> {
  const title = `PIN podpisu ZKP — ${opts.whose}`
  let current: string | null = null
  if (opts.needCurrent) {
    current = (await opts.ask('Wpisz obecny PIN:', title))?.trim() ?? null
    if (!current) return false
  }
  const pin = (await opts.ask('Nowy PIN (4–8 cyfr). Służy do podpisu etapów ZKP — nie podawaj go nikomu:', title))?.trim()
  if (!pin) return false
  const problem = zkpPinProblem(pin)
  if (problem) {
    await opts.notify(problem, false)
    return false
  }
  const again = (await opts.ask('Powtórz nowy PIN:', title))?.trim()
  if (again == null || again === '') return false
  if (again !== pin) {
    await opts.notify('PIN-y się różnią — nic nie zmieniono', false)
    return false
  }
  const err = await opts.save(pin, current)
  await opts.notify(err ?? 'PIN podpisu ZKP ustawiony', !err)
  return !err
}
