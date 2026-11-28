import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type LabelProps,
  type PieLabelRenderProps,
} from 'recharts'
import { widokKategorii, type PodsumowanieKategorii } from '../../lib/statsZlecenia'
import Spinner from '../Spinner'

type Props = {
  category: string
  /** D47: gotowe zestawienia kategorii (z bazy — stat_zlecenia_podsumowanie — albo policzone ze zleceń na starej bazie) */
  podsumowanie: PodsumowanieKategorii | undefined
  loading: boolean
  /** nazwa firmy → nazwa grupy (warianty pisowni razem), z StatsView */
  canon?: (name: unknown) => string
  /** nazwa kategorii w nagłówkach (np. „Drzwi wewnętrzne” zamiast „DrzwiWewnetrzne”) */
  etykieta?: string
  /** 27.11: tylko sekcje liczone ze zleceń (bez „per system / model / kolor”) — drzwi wewnętrzne z Optimy nie mają tych pól
   *  w zleceniu; modele, kolory i rozmiary pokazuje pod spodem InternalDoorStatsDashboard */
  tylkoZlecenia?: boolean
}

// D47 (28.11): liczby liczy baza (albo podsumujZlecenia na starej bazie) — reguły jak dotąd, opisane w lib/statsZlecenia.ts:
// zrealizowane = data wydania albo RO zamknięte w Optimie; czasy realizacji i produkcja bez dat „szacunkowych” z excel-sync
// (testy 27.11, runda 3); produkcja wg miesiąca WYDANIA; top firm po scaleniu pisowni (canon).
export default function CategoryStatsDashboard({ category, podsumowanie, loading, canon, etykieta, tylkoZlecenia = false }: Props) {
  const nazwa = etykieta ?? category
  const [rangeMonths, setRangeMonths] = useState(12)
  const widok = useMemo(() => widokKategorii(podsumowanie, rangeMonths, new Date(), canon), [podsumowanie, rangeMonths, canon])
  const { bezPrawdziwejDaty, productionData, systemData, statusData, topCompaniesData, avgRealizationByMonth, byWeekday, byModel, byWingColor } = widok
  const avgRealizationDays = widok.realizacja?.avg ?? null
  const minRealizationDays = widok.realizacja?.min ?? null
  const maxRealizationDays = widok.realizacja?.max ?? null
  const liczbaZCzasem = widok.realizacja?.count ?? 0

  if (loading) {
    return <div className="stats-dashboard"><Spinner center label="Ładowanie…" /></div>
  }

  return (
    <div className="stats-dashboard">
      <div className="stats-grid-full">
        <div className="stats-card">
          <h3>Średni czas realizacji — {nazwa} <span className="stats-period-note" style={{ fontWeight: 400, fontSize: '0.8em', color: '#6b7280' }}>(kafelki: cała historia; wykres: wybrany okres)</span></h3>
          {bezPrawdziwejDaty > 0 && (
            <p className="stats-note" style={{ color: '#b45309', margin: '0 0 8px' }}>
              Pominięto {bezPrawdziwejDaty} zleceń bez prawdziwej daty wydania (w Excelu był sam znacznik „X”, data jest z dnia synchronizacji) — czas realizacji i wykres produkcji liczone tylko z prawdziwych dat.
            </p>
          )}

          {avgRealizationDays === null ? (
            <p style={{ color: '#6b7280', padding: '20px 0' }}>{bezPrawdziwejDaty > 0 ? 'Brak zamówień z prawdziwą datą wydania' : 'Brak zrealizowanych zamówień w tej kategorii'}</p>
          ) : (
            <>
              <div className="stats-kpi-row">
                <div className="stats-kpi">
                  <div className="stats-kpi-value">{avgRealizationDays}</div>
                  <div className="stats-kpi-label">dni średnio</div>
                </div>
                <div className="stats-kpi">
                  <div className="stats-kpi-value">{minRealizationDays}</div>
                  <div className="stats-kpi-label">minimum</div>
                </div>
                <div className="stats-kpi">
                  <div className="stats-kpi-value">{maxRealizationDays}</div>
                  <div className="stats-kpi-label">maksimum</div>
                </div>
                <div className="stats-kpi">
                  <div className="stats-kpi-value">{liczbaZCzasem}</div>
                  <div className="stats-kpi-label">zamówień</div>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={avgRealizationByMonth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis label={{ value: 'Dni', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="avg"
                    name="Średni czas (dni)"
                    stroke="#10b981"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>

      <div className="stats-grid">
        <div className="stats-card">
          <div className="stats-card-header">
            <h3 title="Suma drzwi z wydanych zleceń wg miesiąca daty wydania">Produkcja w czasie {nazwa}</h3>
            <select
              className="day-filter"
              value={rangeMonths}
              onChange={(e) => setRangeMonths(Number(e.target.value))}
            >
              <option value={3}>3 miesiące</option>
              <option value={6}>6 miesięcy</option>
              <option value={12}>12 miesięcy</option>
              <option value={24}>24 miesiące</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={productionData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="qty" name="Ilość drzwi" stroke="#3b82f6" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {!tylkoZlecenia && <div className="stats-card">
          <h3>Rozkład per system (zrealizowane) {nazwa}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={systemData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" name="Ilość drzwi" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </div>}

        <div className="stats-card">
          <h3>Status zamówień {nazwa}</h3>
          {(() => {
            const total = statusData.reduce((s, d) => s + (Number(d.value) || 0), 0)
            return (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={62}
                outerRadius={98}
                paddingAngle={2}
                minAngle={3}
                labelLine={false}
                label={(p: PieLabelRenderProps) => {
                  // procent w środku tylko dla wystarczająco dużych wycinków
                  if (!p.value || !p.percent || p.percent < 0.08) return null
                  const RAD = Math.PI / 180
                  const inner = Number(p.innerRadius) || 0
                  const outer = Number(p.outerRadius) || 0
                  const r = inner + (outer - inner) * 0.5
                  const x = Number(p.cx) + r * Math.cos(-Number(p.midAngle) * RAD)
                  const y = Number(p.cy) + r * Math.sin(-Number(p.midAngle) * RAD)
                  return (
                    <text x={x} y={y} fill="#fff" fontSize={13} fontWeight={700} textAnchor="middle" dominantBaseline="central">
                      {Math.round(p.percent * 100)}%
                    </text>
                  )
                }}
              >
                {statusData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} stroke="#fff" strokeWidth={2} />
                ))}
                <Label
                  position="center"
                  content={(props: LabelProps) => {
                    // Pie podaje polarny viewBox (cx/cy środka)
                    const vb = (props.viewBox ?? {}) as { cx?: number; cy?: number }
                    const cx = vb.cx ?? 0
                    const cy = vb.cy ?? 0
                    return (
                      <g>
                        <text x={cx} y={cy - 8} textAnchor="middle" fontSize={26} fontWeight={800} fill="#1e293b">{total}</text>
                        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={12} fill="#64748b">drzwi łącznie</text>
                      </g>
                    )
                  }}
                />
              </Pie>
              <Tooltip formatter={(value: unknown, name: unknown) => [`${value} szt.`, String(name)]} />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value: unknown) => {
                  const item = statusData.find((d) => d.name === value)
                  const v = item?.value ?? 0
                  const pct = total > 0 ? Math.round((v / total) * 100) : 0
                  return `${value}: ${v} (${pct}%)`
                }}
              />
            </PieChart>
          </ResponsiveContainer>
            )
          })()}
        </div>

        <div className="stats-card">
          <h3>Top 10 firm {nazwa} <span style={{ fontWeight: 400, fontSize: '0.8em', color: '#6b7280' }}>(cała historia, bez anulowanych)</span></h3>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={topCompaniesData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" name="Ilość drzwi" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <h3>Zamówienia per dzień tygodnia — {nazwa}</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byWeekday}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" name="Ilość drzwi" fill="#06b6d4" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {!tylkoZlecenia && <div className="stats-grid-full">
        <div className="stats-card">
          <h3>Rozkład per model — {nazwa} <span style={{ fontWeight: 400, fontSize: '0.8em', color: '#6b7280' }}>(wszystkie nieanulowane)</span></h3>
          <ResponsiveContainer width="100%" height={450}>
            <BarChart data={byModel} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={180} />
              <Tooltip />
              <Bar dataKey="value" name="Ilość drzwi" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>}

      {!tylkoZlecenia && <div className="stats-grid-full">
        <div className="stats-card">
          <h3>Rozkład per kolor skrzydła — {nazwa} <span style={{ fontWeight: 400, fontSize: '0.8em', color: '#6b7280' }}>(wszystkie nieanulowane)</span></h3>
          <ResponsiveContainer width="100%" height={450}>
            <BarChart data={byWingColor} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={180} />
              <Tooltip />
              <Bar dataKey="value" name="Ilość drzwi" fill="#ec4899" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>}
    </div>
  )
}
