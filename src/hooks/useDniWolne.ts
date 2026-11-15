// =====================================================================
// Dni wolne do podpowiedzi terminu (brief pkt 25): jedno pobranie na sesję aplikacji
// (cache modułu), bo lista zmienia się rzadko (święta raz w roku, dni firmowe ręcznie).
// `invalidateDniWolne()` po zapisie w Ustawieniach → Dni wolne.
// =====================================================================
import { useEffect, useState } from 'react'
import { fetchDniWolne } from './useCrm'

let cache: Set<string> | null = null
let pending: Promise<Set<string>> | null = null
const listeners = new Set<(s: Set<string>) => void>()

async function loadDniWolne(): Promise<Set<string>> {
  if (cache) return cache
  if (!pending) {
    pending = fetchDniWolne()
      .then((r) => {
        cache = new Set((r.error ? [] : r.data).map((d) => d.data))
        for (const l of listeners) l(cache)
        return cache
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

/** Po dodaniu/usunięciu dnia firmowego — następne użycie pobierze listę na nowo. */
export function invalidateDniWolne(): void {
  cache = null
  void loadDniWolne()
}

/** Zbiór dat RRRR-MM-DD (od dziś). Pusty, dopóki się nie wczyta — podpowiedź wtedy liczy tylko weekendy. */
export function useDniWolne(): Set<string> {
  const [set, setSet] = useState<Set<string>>(() => cache ?? new Set())
  useEffect(() => {
    listeners.add(setSet)
    void loadDniWolne().then(setSet)
    return () => {
      listeners.delete(setSet)
    }
  }, [])
  return set
}
