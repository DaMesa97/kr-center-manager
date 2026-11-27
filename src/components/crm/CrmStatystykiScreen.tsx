// CRM → Statystyki (21.11): historia zamkniętych klientów, której nie ma już w bieżącym lejku —
// ile wygraliśmy per miesiąc, skąd przychodzą klienci, dlaczego przegrywamy, kto zamyka sprzedaż.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchKontakty, fetchOfertyWyslane, fetchProfileNames, type CrmError, type CrmKontaktRow } from '../../hooks/useCrm'
import { CRM_KANAL } from '../../types/crm'
import { CRM_WYNIK_POWOD } from '../../lib/crmWynik'
import { OKRESY, miesiacEtykieta, statystykiCrm, type Okres, type StatOferta, type Wiersz } from '../../lib/crmStatystyki'
import Spinner from '../Spinner'

const fmtPln = (v: number | null | undefined): string =>
  v == null ? '—' : `${Number(v).toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} zł`
const fmtProc = (v: number | null) => (v == null ? '—' : `${v}%`)
const KATEGORIA: Record<string, string> = { zewnetrzne: 'Zewnętrzne', wewnetrzne: 'Wewnętrzne', titan: 'Titan', bastion: 'Bastion', alu: 'Aluminium', inne: 'Inne', nieznana: 'Nieznana' }

function TabelaGrup({ tytul, wiersze, etykieta }: { tytul: string; wiersze: Wiersz[]; etykieta: (k: string) => string }) {
  return (
    <section className="crm-k2-card crm-stat-card">
      <h4>{tytul}</h4>
      {wiersze.length === 0 ? (
        <p className="crm-muted">Brak klientów w tym okresie.</p>
      ) : (
        <table className="crm-stat-tabela">
          <thead>
            <tr><th>Skąd</th><th>Nowi</th><th>Zamówili</th><th>Wartość</th><th>Przegrani</th><th>Skuteczność</th></tr>
          </thead>
          <tbody>
            {wiersze.map((w) => (
              <tr key={w.klucz}>
                <td>{etykieta(w.klucz)}</td>
                <td>{w.nowi}</td>
                <td>{w.zamowili}</td>
                <td>{fmtPln(w.wartosc)}</td>
                <td>{w.przegrani}</td>
                <td>{fmtProc(w.skutecznosc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export default function CrmStatystykiScreen() {
  const [leady, setLeady] = useState<CrmKontaktRow[]>([])
  const [oferty, setOferty] = useState<StatOferta[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [okres, setOkres] = useState<Okres>('12m')

  const load = useCallback(async () => {
    setLoading(true)
    const [l, o] = await Promise.all([fetchKontakty(), fetchOfertyWyslane()])
    setLeady(l.data)
    setOferty(o.data)
    setError(l.error ?? o.error)
    setNames(await fetchProfileNames(l.data.map((x) => x.wynik_kto ?? '').filter(Boolean)))
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const s = useMemo(() => statystykiCrm(leady, oferty, okres), [leady, oferty, okres])
  const wykres = s.miesiace.map((m) => ({ ...m, mies: miesiacEtykieta(m.klucz) }))

  if (loading) return <Spinner center label="Liczenie statystyk…" />

  return (
    <div className="crm-screen crm-stat">
      <div className="crm-toolbar">
        <div className="crm-chipy" role="group" aria-label="Okres">
          {OKRESY.map((o) => (
            <button key={o.key} type="button" className={`crm-chip${okres === o.key ? ' crm-chip--on' : ''}`} aria-pressed={okres === o.key} onClick={() => setOkres(o.key)}>{o.label}</button>
          ))}
        </div>
        <span className="crm-toolbar-hint">Wszyscy klienci, także zamknięci i schowani w lejku.</span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()}>Odśwież</button>
      </div>
      {error && <p className="crm-text-bad">{error.message}</p>}

      <div className="crm-stat-kpi">
        <div className="crm-kpi"><span className="crm-kpi-label">Nowi klienci</span><b>{s.kpi.nowi}</b></div>
        <div className="crm-kpi"><span className="crm-kpi-label">Wysłane oferty</span><b>{s.kpi.wyslane.n} · {fmtPln(s.kpi.wyslane.suma)}</b></div>
        <div className="crm-kpi crm-kpi--won"><span className="crm-kpi-label">Zamówili</span><b>{s.kpi.zamowili.n} · {fmtPln(s.kpi.zamowili.suma)}</b></div>
        <div className="crm-kpi"><span className="crm-kpi-label">Przegrani</span><b>{s.kpi.przegrani}</b></div>
        <div className="crm-kpi"><span className="crm-kpi-label" title="Zamówili / (zamówili + przegrani), po dacie wyniku">Skuteczność</span><b>{fmtProc(s.kpi.skutecznosc)}</b></div>
        <div className="crm-kpi"><span className="crm-kpi-label">Średnie zamówienie</span><b>{fmtPln(s.kpi.srWartosc)}</b></div>
        <div className="crm-kpi"><span className="crm-kpi-label" title="Od pierwszego kontaktu do „Zamówił”">Śr. czas do zamówienia</span><b>{s.kpi.srDniDoZamowienia == null ? '—' : `${s.kpi.srDniDoZamowienia} dni`}</b></div>
      </div>

      <div className="crm-stat-wykresy">
        <section className="crm-k2-card crm-stat-card">
          <h4>Klienci miesiąc po miesiącu</h4>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={wykres}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="mies" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="nowi" name="Nowi" fill="#94a3b8" />
              <Bar dataKey="zamowili" name="Zamówili" fill="#059669" />
              <Bar dataKey="przegrani" name="Przegrani" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="crm-k2-card crm-stat-card">
          <h4>Wartość zamówień i wysłanych ofert</h4>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={wykres}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="mies" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)} tys.` : String(v))} />
              <Tooltip formatter={(v) => fmtPln(typeof v === 'number' ? v : Number(v ?? 0))} />
              <Legend />
              <Bar dataKey="wyslaneSuma" name="Wysłane oferty" fill="#93c5fd" />
              <Bar dataKey="wartosc" name="Zamówienia" fill="#059669" />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      <section className="crm-k2-card crm-stat-card">
        <h4>Miesiące</h4>
        <div className="crm-stat-scroll">
          <table className="crm-stat-tabela">
            <thead>
              <tr><th>Miesiąc</th><th>Nowi</th><th>Wysłane oferty</th><th>Zamówili</th><th>Wartość zamówień</th><th>Przegrani</th><th>Skuteczność</th></tr>
            </thead>
            <tbody>
              {[...s.miesiace].reverse().map((m) => (
                <tr key={m.klucz}>
                  <td>{miesiacEtykieta(m.klucz)}</td>
                  <td>{m.nowi}</td>
                  <td>{m.wyslane}{m.wyslane ? <span className="crm-muted"> · {fmtPln(m.wyslaneSuma)}</span> : null}</td>
                  <td>{m.zamowili}</td>
                  <td>{fmtPln(m.wartosc)}</td>
                  <td>{m.przegrani}</td>
                  <td>{fmtProc(m.skutecznosc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="crm-muted crm-stat-uwaga">Pochodzenie i kategorie liczą klientów, którzy przyszli w wybranym okresie, i ilu z nich już zamówiło albo przegrało.</p>
      <div className="crm-stat-wykresy">
        <TabelaGrup tytul="Pochodzenie klientów" wiersze={s.wgZrodla} etykieta={(k) => CRM_KANAL[k]?.label ?? (k === 'nieznane' ? 'Nieznane' : k)} />
        <TabelaGrup tytul="Rodzaj drzwi" wiersze={s.wgKategorii} etykieta={(k) => KATEGORIA[k] ?? k} />
      </div>
      {s.wgKampanii.length > 0 && <TabelaGrup tytul="Kampanie" wiersze={s.wgKampanii} etykieta={(k) => k} />}

      <div className="crm-stat-wykresy">
        <section className="crm-k2-card crm-stat-card">
          <h4>Dlaczego przegrywamy</h4>
          {s.powody.length === 0 ? (
            <p className="crm-muted">Brak przegranych w tym okresie.</p>
          ) : (
            <ul className="crm-stat-powody">
              {s.powody.map((p) => (
                <li key={p.powod}>
                  <span>{CRM_WYNIK_POWOD[p.powod] ?? p.powod}</span>
                  <span className="crm-stat-pasek" aria-hidden="true"><span style={{ width: `${p.proc}%` }} /></span>
                  <b>{p.n}</b>
                  <span className="crm-muted">{p.proc}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="crm-k2-card crm-stat-card">
          <h4>Kto zamyka sprzedaż</h4>
          {s.wgOsoby.length === 0 ? (
            <p className="crm-muted">Nikt nic nie zamknął w tym okresie.</p>
          ) : (
            <table className="crm-stat-tabela">
              <thead><tr><th>Osoba</th><th>Zamówili</th><th>Wartość</th><th>Przegrani</th></tr></thead>
              <tbody>
                {s.wgOsoby.map((o) => (
                  <tr key={o.kto ?? 'auto'}>
                    <td>{o.kto ? names.get(o.kto) ?? 'ktoś z zespołu' : 'automatycznie'}</td>
                    <td>{o.zamowili}</td>
                    <td>{fmtPln(o.wartosc)}</td>
                    <td>{o.przegrani}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
