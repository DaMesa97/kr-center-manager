import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import { useUnsavedGuard } from '../lib/useUnsavedGuard'
import SearchableSelect from './SearchableSelect'
import { WHAT_COMPLAINED_OPTIONS } from '../constants'
import type { ArchivedOrder, ComplaintFormData, Order } from '../types'

type ComplaintFormModalProps = {
  open: boolean
  complaintFormData: ComplaintFormData
  complaintFormLoading: boolean
  orders: Order[]
  archivedOrdersForComplaints: ArchivedOrder[]
  ordersForComplaintSelect: Array<{ id?: number | null; order_number: string; company: string; isArchived: boolean }>
  onClose: () => void
  onFormChange: (patch: Partial<ComplaintFormData>) => void
  onSelectOrder: (order: Order) => void
  onSelectArchived: (archived: ArchivedOrder) => void
  onSave: () => void
  submitOnEnterInInput: (e: React.KeyboardEvent<HTMLElement>, action: () => void) => void
  /** kategoria zakładki (STA, Disting, ST…) — „Szukaj wydanych” szuka tylko w niej */
  category?: string
}

export default function ComplaintFormModal({
  open,
  complaintFormData,
  complaintFormLoading,
  orders,
  archivedOrdersForComplaints,
  ordersForComplaintSelect,
  onClose,
  onFormChange,
  onSelectOrder,
  onSelectArchived,
  onSave,
  submitOnEnterInInput,
  category,
}: ComplaintFormModalProps) {
  const { requestClose } = useUnsavedGuard(complaintFormData, onClose, { enabled: !complaintFormLoading, escape: open, resetKey: open })
  // 27.11 (testy): lista ma tylko niewydane zlecenia, a ok. 1/4 reklamacji dotyczy wydanych — szukanie w bazie
  const [wydane, setWydane] = useState<Order[]>([])
  const [szukaj, setSzukaj] = useState('')
  const [szukam, setSzukam] = useState(false)
  const [szukanoInfo, setSzukanoInfo] = useState('')
  useEffect(() => {
    if (!open) {
      setWydane([])
      setSzukaj('')
      setSzukanoInfo('')
    }
  }, [open])
  const szukajWydanych = async () => {
    const t = szukaj.replace(/[,()%*\\]/g, ' ').trim()
    if (t.length < 2) {
      setSzukanoInfo('Wpisz co najmniej 2 znaki')
      return
    }
    setSzukam(true)
    // testy 27.11 (2. seria): bez kategorii lista mieszała działy (np. 26 drzwi wewnętrznych na 1 STA) i dało się
    // wybrać zlecenie obcego działu — szukamy tylko w kategorii zakładki
    let q = supabase
      .from('orders')
      .select('*')
      .not('release_date', 'is', null)
      .or(`order_number.ilike.%${t}%,company.ilike.%${t}%,client_order_number.ilike.%${t}%`)
    if (category) q = q.eq('category', category)
    const { data, error } = await q.order('release_date', { ascending: false }).limit(30)
    setSzukam(false)
    if (error) {
      setSzukanoInfo(`Błąd szukania: ${error.message}`)
      return
    }
    const lista = (data ?? []) as Order[]
    setWydane(lista)
    setSzukanoInfo(lista.length ? `Znaleziono wydanych${category ? ` (${category})` : ''}: ${lista.length} — są na liście „Zamówienie” ze znaczkiem ✓` : `Nie znaleziono wydanego zlecenia${category ? ` w kategorii ${category}` : ''}`)
  }
  if (!open) return null

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => void requestClose()}
    >
      <div className="order-modal order-modal--sta" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Nowa reklamacja</h2>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={() => void requestClose()}
          >
            X
          </button>
        </div>
        <div
          className="order-form-grid order-form-grid--sta"
          onKeyDown={(e) => submitOnEnterInInput(e, () => void onSave())}
        >
          <label className="order-field-full">
            <span className="order-field-label-text">Zamówienie</span>
            {/* #97/#107: lista zleceń z wyszukiwaniem po numerze i firmie zamiast
                zwykłego selecta z tysiącem pozycji */}
            {(() => {
              type Entry = (typeof ordersForComplaintSelect)[number] & { released?: string | null }
              const labelFor = (o: Entry) => `${o.isArchived ? '📁 ' : o.released ? '✓ ' : ''}${o.order_number} — ${o.company}${o.released ? ` (wydane ${o.released})` : ''}`
              const entries: Entry[] = [
                ...wydane
                  .filter((w) => !ordersForComplaintSelect.some((o) => !o.isArchived && o.id === w.id))
                  .map((w) => ({ id: w.id ?? null, order_number: w.order_number ?? '', company: w.company ?? '', isArchived: false, released: w.release_date ?? null })),
                ...ordersForComplaintSelect,
              ]
              const byLabel = new Map<string, Entry>()
              for (const o of entries) byLabel.set(labelFor(o), o)
              const current = (() => {
                if (complaintFormData.order_id != null) {
                  return entries.find((o) => !o.isArchived && o.id === complaintFormData.order_id)
                }
                if (complaintFormData.order_number) {
                  return ordersForComplaintSelect.find((o) => o.isArchived && o.order_number === complaintFormData.order_number)
                }
                return undefined
              })()
              return (
                <SearchableSelect
                  value={current ? labelFor(current) : ''}
                  options={[...byLabel.keys()]}
                  placeholder="— wpisz numer zlecenia lub firmę —"
                  onChange={(label) => {
                    const o = byLabel.get(label)
                    if (!o) {
                      onFormChange({ order_id: null, order_number: '', company: '' })
                      return
                    }
                    if (o.isArchived) {
                      const a = archivedOrdersForComplaints.find((x) => x.order_number === o.order_number)
                      if (a) onSelectArchived(a)
                    } else {
                      const full = orders.find((x) => x.id === o.id) ?? wydane.find((x) => x.id === o.id)
                      if (full) onSelectOrder(full)
                    }
                  }}
                />
              )
            })()}
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>📁 = zamówienie archiwalne · ✓ = zlecenie już wydane</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              <input
                type="search"
                value={szukaj}
                onChange={(e) => setSzukaj(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    void szukajWydanych()
                  }
                }}
                placeholder="Nie ma na liście? Szukaj wydanego: numer, firma, nr BL"
                style={{ flex: 1 }}
              />
              <button type="button" className="btn btn-secondary btn-sm" disabled={szukam} onClick={() => void szukajWydanych()}>
                {szukam ? 'Szukam…' : 'Szukaj wydanych'}
              </button>
            </span>
            {szukanoInfo && <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{szukanoInfo}</span>}
          </label>
          <label className="order-field-full">
            <span className="order-field-label-text">Co reklamowane</span>
            <select
              value={complaintFormData.what_complained}
              onChange={(e) => onFormChange({ what_complained: e.target.value })}
            >
              <option value="">— wybierz —</option>
              {WHAT_COMPLAINED_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="order-field-full">
            <span className="order-field-label-text">Powód</span>
            <textarea
              rows={3}
              value={complaintFormData.reason}
              onChange={(e) => onFormChange({ reason: e.target.value })}
            />
          </label>
        </div>
        <div className="order-form-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onSave()}
            disabled={complaintFormLoading}
          >
            {complaintFormLoading ? 'Zapisywanie...' : 'Zapisz reklamację'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
