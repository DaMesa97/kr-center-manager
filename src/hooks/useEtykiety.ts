// Słownik etykiet CRM (crm.etykiety, brief pkt 12) — wspólny cache między ekranami
// (lista zadań, karta leada), odświeżany po edycji słownika. Osobny plik, bo
// CrmEtykiety.tsx ma eksportować tylko komponenty (fast refresh).
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CrmEtykieta } from '../types/crm'
import { fetchEtykiety } from './useCrm'

let cache: { lista: CrmEtykieta[]; at: number } | null = null
let inflight: Promise<CrmEtykieta[]> | null = null
const CACHE_MS = 5 * 60_000

async function loadSlownik(force = false): Promise<CrmEtykieta[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.lista
  if (!inflight) {
    inflight = fetchEtykiety()
      .then((r) => {
        cache = { lista: r.data, at: Date.now() }
        return r.data
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useEtykiety(): { lista: CrmEtykieta[]; mapa: Map<string, CrmEtykieta>; reload: () => Promise<void> } {
  const [lista, setLista] = useState<CrmEtykieta[]>(cache?.lista ?? [])
  useEffect(() => {
    let alive = true
    void loadSlownik().then((l) => alive && setLista(l))
    return () => {
      alive = false
    }
  }, [])
  const reload = useCallback(async () => setLista(await loadSlownik(true)), [])
  const mapa = useMemo(() => new Map(lista.map((e) => [e.slug, e])), [lista])
  return { lista, mapa, reload }
}
