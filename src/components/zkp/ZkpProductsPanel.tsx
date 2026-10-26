import { useMemo, useState } from 'react'
import { useZkpRegister } from '../../hooks/useZkpCards'
import { ZKP_CARD_STATUS_LABELS, cardStatus, type ZkpCardStatus, type ZkpRegisterRow } from '../../lib/zkpCard'
import { printRegister633Pdf } from '../../utils/zkpPdf'
import ZkpCardModal, { type ZkpCardTarget } from './ZkpCardModal'
import type { ZkpData } from './ZkpView'
import type { ToastVariant } from '../../types'

// Rejestr wyrobów AS 75EI (zał. 6.33) = wszystkie konstrukcje zleceń ZKP; klik → karta wyrobu (6.25).

type Props = {
  zkp: ZkpData
  roles: string[]
  isManager: boolean
  pushToast: (message: string, variant: ToastVariant) => void
}

type Filter = 'wszystkie' | 'do_zrobienia' | 'zwolnione'

const STATUS_CLASS: Record<ZkpCardStatus, string> = {
  brak: 'badge badge-danger',
  szkic: 'badge badge-neutral',
  zakres: 'badge badge-warning',
  zwolniony: 'badge badge-success',
  niezgodny: 'badge badge-danger',
}

const statusOf = (r: ZkpRegisterRow) => cardStatus({ card_id: r.r_card_id, range_confirmed: r.r_range_confirmed, decision: r.r_decision })

export default function ZkpProductsPanel({ zkp, roles, isManager, pushToast }: Props) {
  const reg = useZkpRegister(pushToast, true)
  const [filter, setFilter] = useState<Filter>('do_zrobienia')
  const [q, setQ] = useState('')
  const [target, setTarget] = useState<ZkpCardTarget | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return reg.rows.filter((r) => {
      const st = statusOf(r)
      if (filter === 'do_zrobienia' && (r.r_status === 'anulowana' || st === 'zwolniony' || st === 'niezgodny')) return false
      if (filter === 'zwolnione' && st !== 'zwolniony') return false
      if (!needle) return true
      return [r.r_construction_no, r.r_order_number, r.r_company, r.r_type_code, r.r_declaration_no]
        .some((v) => String(v ?? '').toLowerCase().includes(needle))
    })
  }, [reg.rows, filter, q])

  const counts = useMemo(() => {
    const active = reg.rows.filter((r) => r.r_status === 'aktywna')
    return { total: active.length, released: active.filter((r) => statusOf(r) === 'zwolniony').length }
  }, [reg.rows])

  const open = (r: ZkpRegisterRow) => {
    if (r.r_status === 'anulowana') {
      pushToast(`Konstrukcja ${r.r_construction_no} jest anulowana — karta niepotrzebna`, 'info')
      return
    }
    setTarget({ constructionId: r.r_construction_id, constructionNo: r.r_construction_no, orderNumber: r.r_order_number, company: r.r_company ?? '' })
  }

  return (
    <div>
      <div className="zkp-toolbar">
        <div className="subtab-bar" role="tablist" aria-label="Filtr kart" style={{ marginBottom: 0 }}>
          {(['do_zrobienia', 'zwolnione', 'wszystkie'] as Filter[]).map((k) => (
            <button key={k} type="button" className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(k)}>
              {k === 'do_zrobienia' ? 'Do zrobienia' : k === 'zwolnione' ? 'Zwolnione' : 'Wszystkie (z anulowanymi)'}
            </button>
          ))}
        </div>
        <input className="zkp-trace-input" style={{ flex: '0 1 280px' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj: numer, OF, klient, deklaracja…" />
        <span className="zkp-hint" style={{ margin: 0 }}>zwolnione {counts.released} / {counts.total} aktywnych konstrukcji</span>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          style={{ marginLeft: 'auto' }}
          disabled={rows.length === 0}
          onClick={() => printRegister633Pdf(rows, `Filtr: ${filter === 'do_zrobienia' ? 'do zrobienia' : filter}${q ? `, „${q}”` : ''} · pozycji ${rows.length}`)}
        >
          🖨 Rejestr 6.33 (PDF)
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void reg.reload()} disabled={reg.loading}>
          {reg.loading ? 'Wczytuję…' : 'Odśwież'}
        </button>
      </div>
      <p className="zkp-hint">
        Konstrukcje zleceń AS 75EI z numerem RRRR/ZZ/PP (nadawany przy „Uruchom do produkcji”). Karta wyrobu: zakres (tabela K) →
        etapy z partiami → okucia i wypełnienia → zwolnienie przez Pełnomocnika. Teczka zlecenia jest kompletna w części karty, gdy
        wszystkie konstrukcje są zwolnione.
      </p>
      <table className="orders-table zkp-register">
        <thead>
          <tr>
            <th>Nr konstrukcji</th><th>Zlecenie</th><th>Klient</th><th>Kod typu (6.8)</th><th>Zakres</th><th>Karta 6.25</th>
            <th>Deklaracja</th><th>Wydanie</th><th>Montaż</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = statusOf(r)
            const cancelled = r.r_status === 'anulowana'
            return (
              <tr key={r.r_construction_id} onClick={() => open(r)} style={{ cursor: cancelled ? 'default' : 'pointer', opacity: cancelled ? 0.5 : 1 }}>
                <td><b style={cancelled ? { textDecoration: 'line-through' } : undefined}>{r.r_construction_no}</b></td>
                <td>{r.r_order_number} <span className="zkp-hint" style={{ margin: 0 }}>· poz. {r.r_pos_no}</span></td>
                <td>{r.r_company || '—'}</td>
                <td><code className="zkp-type-code">{r.r_type_code || '—'}</code></td>
                <td>{r.r_range_code ?? '—'}</td>
                <td><span className={cancelled ? 'badge badge-neutral' : STATUS_CLASS[st]}>{cancelled ? 'anulowana' : ZKP_CARD_STATUS_LABELS[st]}</span></td>
                <td>{r.r_declaration_no || ''}</td>
                <td>{r.r_released_on ?? r.r_release_date ?? ''}</td>
                <td>{r.r_mont_doc ? 'protokół 6.28' : ''}</td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="zkp-hint">
                {reg.loading ? 'Wczytuję…' : reg.rows.length === 0 ? 'Brak konstrukcji zleceń ZKP — zlecenie AS 75EI dostaje numery przy „Uruchom do produkcji”.' : 'Brak pozycji dla filtra.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {target && (
        <ZkpCardModal
          target={target}
          zkp={zkp}
          roles={roles}
          isManager={isManager}
          onClose={() => setTarget(null)}
          onChanged={() => void reg.reload()}
          pushToast={pushToast}
        />
      )}
    </div>
  )
}
