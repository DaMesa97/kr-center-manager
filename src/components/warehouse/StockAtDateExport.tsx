import { useState } from 'react'
import { supabase } from '../../supabaseClient'
import type { ToastVariant, Warehouse } from '../../types'
import { appAlert } from '../../lib/appDialogs'
import { STOCK_HISTORY_RELIABLE_FROM, buildStockAtDateCsv, type StockAtDateRow } from '../../lib/stockAtDateCsv'

type Props = {
  warehouses: Warehouse[]
  /** '' = wszystkie magazyny (jak przełącznik w widoku Stanu) */
  warehouseId: number | ''
  pushToast?: (msg: string, variant: ToastVariant) => void
}

const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// „Stan na dzień…” (zgłoszenie #59): stan fizyczny na koniec wybranego dnia → CSV,
// bez otwierania inwentaryzacji. Liczy RPC get_stock_at_date (dziś minus ruchy po tym dniu).
export default function StockAtDateExport({ warehouses, warehouseId, pushToast }: Props) {
  const [date, setDate] = useState(todayLocal)
  const [busy, setBusy] = useState(false)

  const handleExport = async () => {
    if (!date) return
    // Przed tą datą stany wyzerowano bez ruchu korygującego — „dziś minus ruchy" daje wtedy
    // wartości z sufitu (zgłoszenie: data z marca pokazała stan komponentów, których nie było).
    // Blokada zamiast ostrzeżenia; RPC też odrzuca.
    if (date < STOCK_HISTORY_RELIABLE_FROM) {
      await appAlert(
        `Stan na dzień da się odtworzyć od ${STOCK_HISTORY_RELIABLE_FROM} — wcześniej historia ruchów jest niekompletna (stany wyzerowano bez dokumentu), więc wynik byłby nieprawdziwy.`,
        { title: 'Stan na dzień' },
      )
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('get_stock_at_date', {
        p_date: date,
        p_warehouse_id: warehouseId === '' ? null : warehouseId,
      })
      if (error) {
        pushToast?.(`Błąd eksportu: ${error.message}`, 'error')
        return
      }
      const rows = (data ?? []) as StockAtDateRow[]
      const csv = buildStockAtDateCsv(rows, date)
      const whCode = warehouseId === '' ? 'wszystkie' : (warehouses.find((w) => w.id === warehouseId)?.code ?? 'magazyn')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `stan-${whCode}-${date}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      pushToast?.(`Wyeksportowano ${rows.length} pozycji (stan na ${date})`, 'success')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="stock-at-date" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input
        type="date"
        className="day-filter"
        value={date}
        min={STOCK_HISTORY_RELIABLE_FROM}
        max={todayLocal()}
        onChange={(e) => setDate(e.target.value)}
        title={`Dzień, na którego koniec liczony jest stan (historia kompletna od ${STOCK_HISTORY_RELIABLE_FROM})`}
      />
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy || !date}
        onClick={() => void handleExport()}
        title="Eksport stanu fizycznego na koniec wybranego dnia do pliku CSV (Excel)"
      >
        {busy ? 'Eksportuję…' : '⬇ Stan na dzień'}
      </button>
    </span>
  )
}
