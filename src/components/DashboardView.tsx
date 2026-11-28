import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import type { LeadTimeRule } from '../types'
import { summarizeDashboard, type DashboardRow, type DashboardSummary } from '../lib/dashboardCounts'
import { fetchAllPages } from '../lib/fetchPaged'
import { procent, statusExcela, statusImportuRo, statusWysylkiErp, type StatusSync } from '../lib/pulpitStatus'

// Pulpit KR Center (28.11, makieta właściciela): bez ikon i kolorowych kafelków, bez spraw Po Drzwi i bez
// Technicznych. Układ: pasek czterech liczb → „Wymaga uwagi” (kolejki do decyzji) + synchronizacje
// → tabela kategorii z „po terminie”.

type Props = {
  currentUserFullName: string
  reviewCount: number
  /** zlecenia z erp_status = NIEPOMYŚLNY (RO w Optimie nie powstało) */
  erpErrorCount?: number
  /** synchronizacja wydań z Excela (#116): ile do decyzji, kiedy ostatnia, czy przeterminowana */
  excelSync?: { openCount: number; lastSyncAt: string | null; stale: boolean }
  alertsBadgeCount: number
  /** drugi argument = sekcja Weryfikacji, do której przewinąć (#115) */
  onNavigate: (tab: string, focus?: 'review' | 'excel' | 'erp' | 'duplicates') => void
  /** reguły terminów (order_lead_time_rules) — „Po terminie” dla całej firmy */
  leadTimeRules?: LeadTimeRule[]
}

const KATEGORIE = [
  { key: 'STA', label: 'STA' },
  { key: 'Disting', label: 'Disting' },
  { key: 'ST', label: 'ST' },
  { key: 'Bastion', label: 'Bastion' },
  { key: 'DrzwiWewnetrzne', label: 'Drzwi wewnętrzne' },
  { key: 'Aluminium', label: 'Stolarka aluminiowa' },
] as const

const ORDERS_COUNT_HINT =
  'Zlecenia niewydane i nieanulowane, bez Technicznych. Titan (STA + ST + Bastion) i para Disting Plus (STA + Disting) liczą się jako jedno zlecenie. Tabela kategorii niżej liczy wiersze w zakładkach.'
const READY_HINT =
  'Zlecenia, w których wszystkie etapy produkcji są odhaczone (status „Gotowe” w zakładce Wysyłka). Para Disting Plus / zestaw Titan liczy się raz, gdy każda niewydana noga jest gotowa.'

const EMPTY_SUMMARY: DashboardSummary = {
  inProduction: 0, readyToShip: 0, technicalOpen: 0, technicalOverdue: 0, overdueTotal: 0, overdueByCategory: {},
}

type StanRo = { last_run_at: string | null; last_result: { bledy?: unknown[] } | null } | null

type Kolejka = {
  id: string
  liczba: number
  nazwa: string
  opis: string
  akcja: string
  waga: 'pilne' | 'uwaga'
  idz: () => void
}

const fmt = (n: number) => n.toLocaleString('pl-PL')

export default function DashboardView({
  currentUserFullName,
  reviewCount,
  erpErrorCount = 0,
  excelSync,
  alertsBadgeCount,
  onNavigate,
  leadTimeRules = [],
}: Props) {
  const [loading, setLoading] = useState(true)
  const [wiersze, setWiersze] = useState<Record<string, number>>({})
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY)
  /** testy 27.11 (runda 3): błąd pobierania pokazywał „0 aktywnych zleceń” albo liczbę częściową */
  const [blad, setBlad] = useState<string | null>(null)
  const [wczytano, setWczytano] = useState<Date | null>(null)
  /** undefined = jeszcze nie wczytane (nie pokazujemy wiersza), null = brak danych / błąd odczytu */
  const [stanRo, setStanRo] = useState<StanRo | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: active, error }, ro] = await Promise.all([
        // Jedno zapytanie (porcjami po 1000) o aktywne wiersze — tylko kolumny potrzebne do liczenia
        fetchAllPages<DashboardRow>((from, to) =>
          supabase
            .from('orders')
            .select('id, category, linked_order_id, titan_group:extra_fields->>titan_group, order_date, system, production_stages, alu_progress:extra_fields->alu->progress, top_light, side_panel, side_panel_a, side_panel_b, bastion_frame_type')
            .is('release_date', null)
            .or('extra_fields->>cancelled.is.null,extra_fields->>cancelled.eq.false')
            .order('id', { ascending: true })
            .range(from, to)
            .overrideTypes<DashboardRow[], { merge: false }>(),
        ),
        supabase.from('optima_ro_sync_state').select('last_run_at, last_result').eq('baza', 'KR').maybeSingle(),
      ])
      if (error) console.error('[Pulpit]', error)
      setBlad(error ? (error as { message?: string }).message ?? String(error) : null)
      const naKategorie: Record<string, number> = {}
      for (const o of active) naKategorie[o.category] = (naKategorie[o.category] ?? 0) + 1
      setWiersze(naKategorie)
      setSummary(summarizeDashboard(active, leadTimeRules))
      setStanRo(ro.error ? null : ((ro.data as StanRo) ?? null))
      setWczytano(new Date())
    } finally {
      setLoading(false)
    }
  }, [leadTimeRules])

  useEffect(() => { void load() }, [load])

  const poTerminieKat = useMemo(
    () => KATEGORIE.map((k) => ({ ...k, n: summary.overdueByCategory[k.key] ?? 0 })).filter((k) => k.n > 0).sort((a, b) => b.n - a.n),
    [summary],
  )
  const najwiecejPoTerminie = poTerminieKat[0]
  const maRegulyTerminow = leadTimeRules.length > 0

  const kolejki: Kolejka[] = [
    {
      id: 'weryfikacja', liczba: reviewCount, waga: 'uwaga', nazwa: 'Weryfikacja zleceń',
      opis: 'Zlecenia z bota i Excela czekające na sprawdzenie przez kierownika',
      akcja: 'Otwórz Weryfikację', idz: () => onNavigate('Weryfikacja', 'review'),
    },
    {
      id: 'stany', liczba: alertsBadgeCount, waga: 'pilne', nazwa: 'Stany poniżej progu',
      opis: 'Komponenty poniżej minimum — propozycje zamówień w Zamawianiu',
      akcja: 'Otwórz Zamawianie', idz: () => onNavigate('Zamawianie'),
    },
    ...(excelSync ? [{
      id: 'excel', liczba: excelSync.openCount, waga: 'uwaga' as const, nazwa: 'Excel — do wyjaśnienia',
      opis: 'Wiersze z arkuszy bez jednoznacznego dopasowania do zlecenia',
      akcja: 'Pokaż wiersze', idz: () => onNavigate('Weryfikacja', 'excel'),
    }] : []),
    {
      id: 'erp', liczba: erpErrorCount, waga: 'pilne', nazwa: 'Błędy wysyłki do Optimy',
      opis: 'Zamówienia z konfiguratora, dla których nie powstało RO — popraw i ponów',
      akcja: 'Pokaż błędy', idz: () => onNavigate('Weryfikacja', 'erp'),
    },
    ...(maRegulyTerminow ? [{
      id: 'termin', liczba: summary.overdueTotal, waga: 'pilne' as const, nazwa: 'Zlecenia po terminie',
      opis: poTerminieKat.length ? poTerminieKat.slice(0, 3).map((k) => `${k.label} ${fmt(k.n)}`).join(' · ') : 'Wszystkie zlecenia w terminie',
      akcja: najwiecejPoTerminie ? `Otwórz ${najwiecejPoTerminie.label}` : '',
      idz: () => { if (najwiecejPoTerminie) onNavigate(najwiecejPoTerminie.key) },
    }] : []),
  ]

  const synchronizacje: StatusSync[] = [
    statusExcela(excelSync),
    ...(stanRo === undefined ? [] : [statusImportuRo(stanRo)]),
    statusWysylkiErp(erpErrorCount),
  ]

  const maxWierszy = Math.max(1, ...KATEGORIE.map((k) => wiersze[k.key] ?? 0))
  const pctPoTerminie = procent(summary.overdueTotal, summary.inProduction)
  const dzis = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const imie = currentUserFullName.split(' ')[0]
  const liczba = (n: number) => (loading ? '…' : fmt(n))

  return (
    <div className="pulpit">
      <div className="pulpit-naglowek">
        <div>
          <h1 className="pulpit-tytul">Stan produkcji</h1>
          <p className="pulpit-podtytul">
            {dzis.charAt(0).toUpperCase() + dzis.slice(1)}
            {wczytano && ` · dane z ${wczytano.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`}
            {imie && ` · ${imie}`}
          </p>
        </div>
        <button type="button" className="pulpit-przycisk" onClick={() => void load()} disabled={loading}>
          {loading ? 'Wczytuję…' : 'Odśwież'}
        </button>
      </div>

      {blad && (
        <div className="pulpit-blad" role="alert">
          Nie udało się wczytać przeglądu ({blad}) — liczby mogą być niepełne. Kliknij Odśwież.
        </div>
      )}

      <section className="pulpit-pasek" aria-label="Podsumowanie">
        <div className="pulpit-pasek-pole" title={ORDERS_COUNT_HINT}>
          <div className="pulpit-etykieta">W produkcji</div>
          <div className="pulpit-duza">{liczba(summary.inProduction)}</div>
          <div className="pulpit-opis">zleceń aktywnych</div>
        </div>
        {maRegulyTerminow && (
          <button type="button" className="pulpit-pasek-pole" onClick={() => najwiecejPoTerminie && onNavigate(najwiecejPoTerminie.key)}>
            <div className="pulpit-etykieta">Po terminie</div>
            <div className={`pulpit-duza ${summary.overdueTotal > 0 ? 'pulpit-czerwony' : ''}`}>{liczba(summary.overdueTotal)}</div>
            <div className="pulpit-opis">{loading || pctPoTerminie == null ? '—' : `${pctPoTerminie}% zleceń w produkcji`}</div>
          </button>
        )}
        <button type="button" className="pulpit-pasek-pole" onClick={() => onNavigate('Wysyłka')} title={READY_HINT}>
          <div className="pulpit-etykieta">Do wysłania</div>
          <div className="pulpit-duza">{liczba(summary.readyToShip)}</div>
          <div className="pulpit-opis">wszystkie etapy odhaczone</div>
        </button>
        <button type="button" className="pulpit-pasek-pole" onClick={() => onNavigate('Zamawianie')}>
          <div className="pulpit-etykieta">Stany poniżej progu</div>
          <div className={`pulpit-duza ${alertsBadgeCount > 0 ? 'pulpit-czerwony' : ''}`}>{fmt(alertsBadgeCount)}</div>
          <div className="pulpit-opis">komponentów do zamówienia</div>
        </button>
      </section>

      <div className="pulpit-kolumny">
        <section className="pulpit-panel pulpit-panel--szeroki" aria-labelledby="pulpit-uwaga">
          <div className="pulpit-panel-naglowek">
            <h2 id="pulpit-uwaga">Wymaga uwagi</h2>
          </div>
          {kolejki.map((k) => (
            <div key={k.id} className="pulpit-kolejka">
              <div className={`pulpit-kolejka-liczba ${k.liczba === 0 ? 'pulpit-szary' : k.waga === 'pilne' ? 'pulpit-czerwony' : 'pulpit-bursztyn'}`}>
                {k.id === 'termin' ? liczba(k.liczba) : fmt(k.liczba)}
              </div>
              <div className="pulpit-kolejka-tekst">
                <div className="pulpit-kolejka-nazwa">{k.nazwa}</div>
                <div className="pulpit-opis">{k.opis}</div>
              </div>
              {k.akcja && k.liczba > 0 ? (
                <button type="button" className="pulpit-link" onClick={k.idz}>{k.akcja}</button>
              ) : (
                <span className="pulpit-opis">brak</span>
              )}
            </div>
          ))}
        </section>

        <section className="pulpit-panel pulpit-panel--waski" aria-labelledby="pulpit-sync">
          <div className="pulpit-panel-naglowek">
            <h2 id="pulpit-sync">Synchronizacje</h2>
          </div>
          {synchronizacje.map((s) => (
            <div key={s.nazwa} className="pulpit-sync">
              <div className="pulpit-sync-nazwa">{s.nazwa}</div>
              <div className={`pulpit-status ${s.ok ? 'pulpit-zielony' : 'pulpit-czerwony'}`}>{s.ok ? 'Działa' : 'Błąd'}</div>
              <div className="pulpit-opis">{s.opis}</div>
              <div className="pulpit-opis pulpit-prawo">{s.kiedy}</div>
            </div>
          ))}
          <p className="pulpit-przypis">Błąd = ostatnia próba się nie udała albo dawno nie było udanej.</p>
        </section>
      </div>

      <section className="pulpit-panel" aria-labelledby="pulpit-kat">
        <div className="pulpit-panel-naglowek">
          <h2 id="pulpit-kat">Zlecenia w toku według kategorii</h2>
          <span className="pulpit-opis">kliknij kategorię, aby otworzyć listę</span>
        </div>
        <div className="pulpit-tabela-ramka">
          <table className="pulpit-tabela">
            <thead>
              <tr>
                <th scope="col">Kategoria</th>
                <th scope="col" className="pulpit-prawo">W toku</th>
                {maRegulyTerminow && <th scope="col" className="pulpit-prawo">Po terminie</th>}
                {maRegulyTerminow && <th scope="col" className="pulpit-prawo">Udział po terminie</th>}
                <th scope="col" className="pulpit-kol-pasek">Wolumen</th>
              </tr>
            </thead>
            <tbody>
              {KATEGORIE.map((k) => {
                const n = wiersze[k.key] ?? 0
                const po = summary.overdueByCategory[k.key] ?? 0
                const pct = procent(po, n)
                return (
                  <tr key={k.key}>
                    <th scope="row">
                      <button type="button" className="pulpit-link pulpit-link--ciemny" onClick={() => onNavigate(k.key)}>{k.label}</button>
                    </th>
                    <td className="pulpit-prawo pulpit-pogrubione">{liczba(n)}</td>
                    {maRegulyTerminow && (
                      <td className={`pulpit-prawo ${pct != null && pct >= 50 ? 'pulpit-czerwony pulpit-pogrubione' : ''}`}>{liczba(po)}</td>
                    )}
                    {maRegulyTerminow && <td className="pulpit-prawo pulpit-szary">{loading || pct == null ? '—' : `${pct}%`}</td>}
                    <td className="pulpit-kol-pasek">
                      <div className="pulpit-pasek-tlo" aria-hidden="true">
                        <div className="pulpit-pasek-wypelnienie" style={{ width: `${Math.max(n > 0 ? 1 : 0, Math.round((n * 100) / maxWierszy))}%` }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
