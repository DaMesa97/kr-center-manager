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
      {/* v3 (makieta „Statystyki”, 27.11): nagłówek, okres w szarej pigułce, 4 kafelki zamiast 7 */}
      <div className="crm-head">
        <div className="crm-head-tekst">
          <h2>Statystyki</h2>
          <span className="crm-head-sub">Wszyscy klienci, także zamknięci i schowani w lejku · po dacie wyniku</span>
        </div>
        <div className="crm-seg" role="group" aria-label="Okres">
          {OKRESY.map((o) => (
            <button key={o.key} type="button" className={`crm-seg-btn${okres === o.key ? ' crm-seg-btn--on' : ''}`} aria-pressed={okres === o.key} onClick={() => setOkres(o.key)}>{o.label}</button>
          ))}
        </div>
      </div>
      {error && <p className="crm-text-bad">{error.message}</p>}

      <div className="crm-kafle">
        <div className="crm-kafel"><span>Nowi klienci</span><b>{s.kpi.nowi}</b></div>
        <div className="crm-kafel"><span>Wysłane oferty</span><b>{s.kpi.wyslane.n}</b><span>za {fmtPln(s.kpi.wyslane.suma)}</span></div>
        <div className="crm-kafel"><span>Zamówili</span><b className="crm-kafel--ok">{s.kpi.zamowili.n}</b><span>za {fmtPln(s.kpi.zamowili.suma)} · średnio {fmtPln(s.kpi.srWartosc)}</span></div>
        <div className="crm-kafel" title="Zamówili / (zamówili + przegrani), po dacie wyniku"><span>Skuteczność</span><b>{fmtProc(s.kpi.skutecznosc)}</b><span>przegrani {s.kpi.przegrani}{s.kpi.srDniDoZamowienia == null ? '' : ` · śr. ${s.kpi.srDniDoZamowienia} dni do zamówienia`}</span></div>
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
              <Bar dataKey="nowi" name="Nowi" fill="#c9d7fb" />
              <Bar dataKey="zamowili" name="Zamówili" fill="#2457d6" />
              <Bar dataKey="przegrani" name="Przegrani" fill="#b0b8c4" />
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
              <Bar dataKey="wyslaneSuma" name="Wysłane oferty" fill="#c9d7fb" />
              <Bar dataKey="wartosc" name="Zamówienia" fill="#2457d6" />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      <details className="crm-karta crm-stat-card">
        <summary>Tabela miesięcy (nowi, oferty, zamówienia, przegrani)</summary>
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
      </details>

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
