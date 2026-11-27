import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../supabaseClient'
import DataTable, { type DataTableColumn } from '../DataTable'
import SearchableSelect from '../SearchableSelect'
import Spinner from '../Spinner'
import { isInternalDoorComponent } from '../../lib/internalWarehouse'
import { isInternalWarehouseCode } from '../../utils'
import { generateWzReklamacyjnyPdf, type WzrPdfData } from '../../utils/wzReklamacyjnyPdf'
import { appConfirm, appPrompt } from '../../lib/appDialogs'
import type { ToastVariant, Warehouse, WarehouseComponent } from '../../types'

type Props = {
  warehouses: Warehouse[]
  components: WarehouseComponent[]
  /** wystawianie i anulowanie (uprawnienie do ruchów magazynowych) */
  canEdit: boolean
  pushToast: (msg: string, variant: ToastVariant) => void
  onStockChanged?: () => void
}

type Pozycja = { component_id: number; quantity: number; uwagi: string | null; warehouse_components: { code: string | null; name: string; unit: string | null } | null }
type Wzr = {
  id: number
  numer: string
  warehouse_id: number
  complaint_id: number | null
  firma: string | null
  nr_zlecenia: string | null
  powod: string | null
  uwagi: string | null
  created_at: string
  anulowany_at: string | null
  anulowany_powod: string | null
  complaints: { complaint_number: string | null } | null
  wz_reklamacyjne_pozycje: Pozycja[]
}

type Item = { component_id: number; quantity: number; uwagi: string }
type Form = {
  warehouse_id: number | null
  reklamacja: string
  complaint_id: number | null
  complaint_label: string
  firma: string
  nr_zlecenia: string
  powod: string
  uwagi: string
  items: Item[]
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))))
const dataPl = (iso: string) => new Date(iso).toLocaleDateString('pl-PL')
const label = (c: WarehouseComponent) => `${c.code ? `${c.code} — ` : ''}${c.name}`

/**
 * Dokumenty → WZ reklamacyjne (27.11): wydanie towaru na reklamację z wybranego magazynu
 * (Magazyn 1 / Magazyn 2 drzwi wewnętrznych albo magazyn surowców). Zdejmuje stan, numer WZR/RRRR/NNN,
 * PDF do podpisu; anulowanie oddaje towar na ten sam magazyn (ZWR).
 */
export default function WzReklamacyjneView({ warehouses, components, canEdit, pushToast, onStockChanged }: Props) {
  const [rows, setRows] = useState<Wzr[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  // testy 27.11 (runda 3): blokada przed podwójnym kliknięciem już przed sprawdzeniem stanu (było: dwa WZR, podwójne zdjęcie)
  const wzrWToku = useRef(false)
  const [q, setQ] = useState('')
  const whName = useCallback((id: number) => warehouses.find((w) => w.id === id)?.name ?? `#${id}`, [warehouses])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('wz_reklamacyjne')
      .select('*, complaints(complaint_number), wz_reklamacyjne_pozycje(component_id, quantity, uwagi, warehouse_components(code, name, unit))')
      .order('created_at', { ascending: false })
      .limit(500)
    setLoading(false)
    if (error) {
      pushToast(`Nie wczytano WZ reklamacyjnych: ${error.message}`, 'error')
      return
    }
    setRows((data ?? []) as unknown as Wzr[])
  }, [pushToast])

  useEffect(() => {
    void load()
  }, [load])

  const pdfData = (w: Wzr): WzrPdfData => ({
    numer: w.numer,
    data: dataPl(w.created_at),
    magazyn: whName(w.warehouse_id),
    firma: w.firma,
    nrZlecenia: w.nr_zlecenia,
    reklamacja: w.complaints?.complaint_number ?? null,
    powod: w.powod,
    uwagi: w.uwagi,
    anulowany: w.anulowany_at ? `${dataPl(w.anulowany_at)}${w.anulowany_powod ? ` (${w.anulowany_powod})` : ''}` : null,
    pozycje: w.wz_reklamacyjne_pozycje.map((p) => ({
      kod: p.warehouse_components?.code ?? null,
      nazwa: p.warehouse_components?.name ?? `#${p.component_id}`,
      jm: p.warehouse_components?.unit ?? 'szt',
      ilosc: Number(p.quantity),
      uwagi: p.uwagi,
    })),
  })

  const anuluj = async (w: Wzr) => {
    // 27.11 (testy agentów): window.prompt nie działa w aplikacji na komputerze (Electron) — „Anuluj” nic nie robiło
    const powod = await appPrompt(`Anulować ${w.numer}? Towar wróci na ${whName(w.warehouse_id)}.\nPowód (opcjonalnie):`, { title: 'Anulować WZ reklamacyjny?', confirmLabel: 'Anuluj WZ' })
    if (powod === null) return
    const { error } = await supabase.rpc('cancel_wz_reklamacyjny', { p_id: w.id, p_powod: powod || null })
    if (error) {
      pushToast(`Nie anulowano: ${error.message}`, 'error')
      return
    }
    pushToast(`${w.numer} anulowany — towar wrócił na ${whName(w.warehouse_id)}`, 'success')
    onStockChanged?.()
    await load()
  }

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows
    return rows.filter((w) =>
      [w.numer, w.firma, w.nr_zlecenia, w.powod, w.complaints?.complaint_number, ...w.wz_reklamacyjne_pozycje.map((p) => `${p.warehouse_components?.code ?? ''} ${p.warehouse_components?.name ?? ''}`)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(t),
    )
  }, [rows, q])

  const columns: DataTableColumn<Wzr>[] = [
    { key: 'numer', label: 'NUMER', render: (w) => <strong>{w.numer}</strong> },
    { key: 'data', label: 'DATA', render: (w) => dataPl(w.created_at) },
    { key: 'mag', label: 'MAGAZYN', render: (w) => whName(w.warehouse_id) },
    { key: 'firma', label: 'FIRMA', render: (w) => w.firma ?? '—' },
    { key: 'zlec', label: 'NR ZLECENIA', render: (w) => w.nr_zlecenia ?? '—' },
    { key: 'rekl', label: 'REKLAMACJA', render: (w) => w.complaints?.complaint_number ?? '—' },
    {
      key: 'poz',
      label: 'POZYCJE',
      render: (w) => (
        <span style={{ fontSize: '0.85rem' }}>
          {w.wz_reklamacyjne_pozycje.map((p) => `${fmt(Number(p.quantity))} × ${p.warehouse_components?.name ?? `#${p.component_id}`}`).join('; ')}
        </span>
      ),
    },
    { key: 'powod', label: 'POWÓD', render: (w) => w.powod ?? '—' },
    {
      key: 'status',
      label: 'STATUS',
      render: (w) =>
        w.anulowany_at ? (
          <span style={{ color: '#b3261e', fontWeight: 600 }} title={w.anulowany_powod ?? undefined}>anulowany {dataPl(w.anulowany_at)}</span>
        ) : (
          'wydany'
        ),
    },
    {
      key: 'akcje',
      label: '',
      stopRowClick: true,
      render: (w) => (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => generateWzReklamacyjnyPdf(pdfData(w))}>↓ PDF</button>
          {canEdit && !w.anulowany_at && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void anuluj(w)}>Anuluj</button>
          )}
        </span>
      ),
    },
  ]

  const nowy = () => {
    const wew = warehouses.find((w) => w.is_active && isInternalWarehouseCode(w.code))
    setForm({
      warehouse_id: wew?.id ?? null,
      reklamacja: '',
      complaint_id: null,
      complaint_label: '',
      firma: '',
      nr_zlecenia: '',
      powod: '',
      uwagi: '',
      items: [{ component_id: 0, quantity: 1, uwagi: '' }],
    })
  }

  return (
    <div className="wzr-view">
      <p className="muted" style={{ marginTop: 0 }}>
        WZ reklamacyjny = wydanie towaru na reklamację (np. skrzydło na wymianę) z wybranego magazynu. Zdejmuje stan od razu; anulowanie oddaje towar na ten sam magazyn.
      </p>
      <div className="orders-filters" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <input type="text" className="search-input" placeholder="Szukaj: numer, firma, zlecenie, reklamacja, towar…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 260px' }} />
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} disabled={loading}>Odśwież</button>
        {canEdit && (
          <button type="button" className="btn btn-success" onClick={nowy}>+ Nowy WZ reklamacyjny</button>
        )}
      </div>
      {loading && rows.length === 0 ? (
        <Spinner center label="Wczytywanie WZ reklamacyjnych…" />
      ) : (
        <DataTable rows={shown} rowKey={(w) => w.id} columns={columns} wrapperClassName="orders-table-wrapper" emptyText="Brak WZ reklamacyjnych" />
      )}
      {form && (
        <WzrFormModal
          form={form}
          setForm={setForm}
          warehouses={warehouses}
          components={components}
          saving={saving}
          onClose={() => setForm(null)}
          onSave={async () => {
            if (wzrWToku.current) return
            wzrWToku.current = true
            setSaving(true)
            try {
            if (!form.warehouse_id) { pushToast('Wybierz magazyn', 'error'); return }
            const items = form.items.filter((it) => it.component_id > 0 && it.quantity > 0)
            if (items.length === 0) { pushToast('Dodaj co najmniej jedną pozycję (towar i ilość)', 'error'); return }
            // 27.11 (testy agentów): ten sam towar w kilku wierszach sumujemy i przy braku pytamy (stan zejdzie na minus)
            const suma = new Map<number, number>()
            for (const it of items) suma.set(it.component_id, (suma.get(it.component_id) ?? 0) + it.quantity)
            const { data: st } = await supabase.from('warehouse_stock').select('component_id, quantity')
              .eq('warehouse_id', form.warehouse_id).in('component_id', [...suma.keys()])
            const stan = new Map(((st ?? []) as Array<{ component_id: number; quantity: number }>).map((x) => [Number(x.component_id), Number(x.quantity) || 0]))
            const braki = [...suma.entries()].filter(([id, q]) => (stan.get(id) ?? 0) < q)
            if (braki.length) {
              const nazwa = (id: number) => components.find((c) => c.id === id)?.name ?? `#${id}`
              const ok = await appConfirm(
                `Na magazynie ${whName(form.warehouse_id)} brakuje:\n${braki.map(([id, q]) => `• ${nazwa(id)}: wydajesz ${q}, na stanie ${stan.get(id) ?? 0}`).join('\n')}\n\nWydać mimo to? Stan zejdzie na minus.`,
                { title: 'Brak na stanie', confirmLabel: 'Wydaj mimo to', tone: 'danger' },
              )
              if (!ok) return
            }
            setSaving(true)
            const { data, error } = await supabase.rpc('create_wz_reklamacyjny', {
              p_warehouse_id: form.warehouse_id,
              p_items: items.map((it) => ({ component_id: it.component_id, quantity: it.quantity, uwagi: it.uwagi || null })),
              p_firma: form.firma || null,
              p_nr_zlecenia: form.nr_zlecenia || null,
              p_complaint_id: form.complaint_id,
              p_powod: form.powod || null,
              p_uwagi: form.uwagi || null,
            })
            setSaving(false)
            if (error) { pushToast(`Nie wystawiono WZ: ${error.message}`, 'error'); return }
            const res = (Array.isArray(data) ? data[0] : data) as { r_id: number; r_numer: string } | null
            pushToast(`Wystawiono ${res?.r_numer ?? 'WZ reklamacyjny'} — stan zdjęty z ${whName(form.warehouse_id)}`, 'success')
            setForm(null)
            onStockChanged?.()
            await load()
            // od razu PDF do podpisu
            if (res?.r_id) {
              const { data: one } = await supabase
                .from('wz_reklamacyjne')
                .select('*, complaints(complaint_number), wz_reklamacyjne_pozycje(component_id, quantity, uwagi, warehouse_components(code, name, unit))')
                .eq('id', res.r_id)
                .maybeSingle()
              if (one) generateWzReklamacyjnyPdf(pdfData(one as unknown as Wzr))
            }
            } finally {
              wzrWToku.current = false
              setSaving(false)
            }
          }}
        />
      )}
    </div>
  )
}

function WzrFormModal({
  form,
  setForm,
  warehouses,
  components,
  saving,
  onClose,
  onSave,
}: {
  form: Form
  setForm: Dispatch<SetStateAction<Form | null>>
  warehouses: Warehouse[]
  components: WarehouseComponent[]
  saving: boolean
  onClose: () => void
  onSave: () => Promise<void>
}) {
  const wh = warehouses.find((w) => w.id === form.warehouse_id) ?? null
  const internal = wh ? isInternalWarehouseCode(wh.code) : true
  // magazyn drzwi wewnętrznych → kartoteki drzwi wewnętrznych (najpierw trzymane na magazynie), inny → surowce
  const pool = useMemo(
    () =>
      components
        .filter((c) => c.is_active && (internal ? isInternalDoorComponent(c) : !isInternalDoorComponent(c)))
        .sort((a, b) => Number(b.is_stocked !== false) - Number(a.is_stocked !== false) || a.name.localeCompare(b.name, 'pl')),
    [components, internal],
  )
  const options = useMemo(() => pool.map(label), [pool])
  const byLabel = useMemo(() => new Map(pool.map((c) => [label(c), c.id])), [pool])
  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])

  // stan wybranych pozycji w wybranym magazynie
  const [stany, setStany] = useState<Map<number, number>>(new Map())
  const ids = useMemo(() => [...new Set(form.items.map((i) => i.component_id).filter((id) => id > 0))], [form.items])
  useEffect(() => {
    if (!form.warehouse_id || ids.length === 0) { setStany(new Map()); return }
    let aktywne = true
    void supabase
      .from('warehouse_stock')
      .select('component_id, quantity')
      .eq('warehouse_id', form.warehouse_id)
      .in('component_id', ids)
      .then(({ data }) => {
        if (aktywne) setStany(new Map((data ?? []).map((r) => [Number(r.component_id), Number(r.quantity) || 0])))
      })
    return () => { aktywne = false }
  }, [form.warehouse_id, ids])

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const setItem = (i: number, patch: Partial<Item>) => set({ items: form.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) })

  // reklamacja z modułu Reklamacje (opcjonalnie): po numerze, podpowiada firmę i nr zlecenia
  const [szukam, setSzukam] = useState(false)
  const znajdzReklamacje = async () => {
    const nr = form.reklamacja.trim()
    if (!nr) { set({ complaint_id: null, complaint_label: '' }); return }
    setSzukam(true)
    const KOL = 'id, complaint_number, company, order_number, client_order_number, category, linked_complaint_id'
    type Rek = { id: number; complaint_number: string; company: string | null; order_number: string | null; client_order_number: string | null; category: string | null; linked_complaint_id: number | null }
    // 27.11 (testy agentów): „XL/Bastion/16” pasowało też do „XL/Bastion/160” → „kilka pasuje” mimo pełnego numeru
    const dokladnie = await supabase.from('complaints').select(KOL).ilike('complaint_number', nr).limit(3)
    let dok = (dokladnie.data ?? []) as Rek[]
    // 2. seria: para Disting Plus to z założenia dwa wiersze z tym samym numerem (STA + Disting) — bierzemy wiersz STA
    if (dok.length === 2 && dok[0].linked_complaint_id === dok[1].id && dok[1].linked_complaint_id === dok[0].id) {
      dok = [dok.find((r) => r.category === 'STA') ?? (dok[0].id < dok[1].id ? dok[0] : dok[1])]
    }
    const { data } = dok.length === 1
      ? { data: dok }
      : await supabase.from('complaints').select(KOL).ilike('complaint_number', `%${nr}%`).order('id', { ascending: false }).limit(2)
    setSzukam(false)
    const list = (data ?? []) as Rek[]
    if (list.length !== 1) {
      set({ complaint_id: null, complaint_label: list.length === 0 ? 'nie znaleziono — WZ będzie bez powiązania' : 'kilka pasuje — wpisz pełny numer' })
      return
    }
    const c = list[0]
    set({
      complaint_id: c.id,
      complaint_label: `✓ ${c.complaint_number}${c.company ? ` · ${c.company}` : ''}`,
      reklamacja: c.complaint_number,
    })
    // firma / nr zlecenia tylko, gdy wciąż puste (sprawdzane na bieżącym formularzu, nie sprzed zapytania)
    setForm((f) => (f ? { ...f, firma: f.firma || c.company || '', nr_zlecenia: f.nr_zlecenia || c.order_number || c.client_order_number || '' } : f))
  }

  const itemColumns: DataTableColumn<Item>[] = [
    {
      key: 'c',
      label: 'TOWAR',
      thStyle: { width: '52%' },
      tdClassName: 'recipe-editor-component-cell',
      render: (it, i) => (
        <SearchableSelect
          value={it.component_id > 0 && byId.get(it.component_id) ? label(byId.get(it.component_id)!) : ''}
          onChange={(v) => setItem(i, { component_id: byLabel.get(v) ?? 0 })}
          options={options}
          placeholder="— wybierz towar —"
          disabled={saving}
        />
      ),
    },
    {
      key: 'stan',
      label: 'STAN',
      align: 'right',
      thStyle: { width: '9%' },
      render: (it) => {
        if (!(it.component_id > 0)) return '—'
        const s = stany.get(it.component_id) ?? 0
        return <span style={s < it.quantity ? { color: '#b3261e', fontWeight: 700 } : undefined} title={s < it.quantity ? 'Na tym magazynie jest mniej — stan zejdzie na minus' : undefined}>{fmt(s)}</span>
      },
    },
    {
      key: 'q',
      label: 'ILOŚĆ',
      thStyle: { width: '11%' },
      render: (it, i) => (
        <input type="number" min={0} step={1} value={it.quantity} onChange={(e) => setItem(i, { quantity: parseFloat(e.target.value) || 0 })} disabled={saving} />
      ),
    },
    {
      key: 'u',
      label: 'UWAGI',
      thStyle: { width: '20%' },
      render: (it, i) => <input type="text" value={it.uwagi} onChange={(e) => setItem(i, { uwagi: e.target.value })} disabled={saving} />,
    },
    {
      key: 'x',
      label: '',
      thStyle: { width: '8%' },
      render: (_it, i) => (
        <button type="button" className="btn btn-sm btn-danger" onClick={() => set({ items: form.items.filter((_, k) => k !== i) })} disabled={saving}>Usuń</button>
      ),
    },
  ]

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => { if (!saving) onClose() }}>
      <div className="order-modal order-modal--sta recipe-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Nowy WZ reklamacyjny</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>X</button>
        </div>
        <div className="recipe-editor-modal-body">
          <div className="order-form-grid order-form-grid--sta recipe-editor-modal-form-top">
            <label className="order-field-full">
              <span className="order-field-label-text">Magazyn (z którego wydajesz)</span>
              <select
                value={form.warehouse_id ?? ''}
                onChange={(e) => {
                  // 27.11 (testy agentów): pozycje wybrane dla poprzedniego magazynu schodziłyby z nowego (drzwi z Marklowickiej)
                  const wybrane = form.items.some((it) => it.component_id > 0)
                  set({ warehouse_id: e.target.value ? Number(e.target.value) : null, ...(wybrane ? { items: [{ component_id: 0, quantity: 1, uwagi: '' }] } : {}) })
                }}
                disabled={saving}
              >
                <option value="">— wybierz magazyn —</option>
                {warehouses.filter((w) => w.is_active).map((w) => (
                  <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                ))}
              </select>
            </label>
            <label className="order-field-full">
              <span className="order-field-label-text">Reklamacja (opcjonalnie, nr z modułu Reklamacje)</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <input type="text" value={form.reklamacja} onChange={(e) => set({ reklamacja: e.target.value, complaint_id: null, complaint_label: '' })} onBlur={() => void znajdzReklamacje()} placeholder="np. XL/STA/221" disabled={saving} style={{ flex: 1 }} />
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => void znajdzReklamacje()} disabled={saving || szukam}>{szukam ? '…' : 'Znajdź'}</button>
              </span>
              {form.complaint_label && <span className="muted" style={{ fontSize: '0.8rem' }}>{form.complaint_label}</span>}
            </label>
            <label className="order-field-full">
              <span className="order-field-label-text">Firma / klient</span>
              <input type="text" value={form.firma} onChange={(e) => set({ firma: e.target.value })} disabled={saving} />
            </label>
            <label className="order-field-full">
              <span className="order-field-label-text">Nr zlecenia (RO / zamówienie)</span>
              <input type="text" value={form.nr_zlecenia} onChange={(e) => set({ nr_zlecenia: e.target.value })} disabled={saving} />
            </label>
            <label className="order-field-full">
              <span className="order-field-label-text">Powód</span>
              <input type="text" value={form.powod} onChange={(e) => set({ powod: e.target.value })} placeholder="np. uszkodzone skrzydło — wymiana" disabled={saving} />
            </label>
            <label className="order-field-full">
              <span className="order-field-label-text">Uwagi</span>
              <input type="text" value={form.uwagi} onChange={(e) => set({ uwagi: e.target.value })} disabled={saving} />
            </label>
          </div>
          <div className="recipe-editor-positions-section">
            <h3 style={{ margin: '0.75rem 0 0' }}>Pozycje</h3>
            <div className="recipe-editor-positions-scroll">
              <DataTable
                rows={form.items}
                rowKey={(_r, i) => i}
                columns={itemColumns}
                className="recipe-editor-positions-table"
                tableStyle={{ width: '100%', tableLayout: 'fixed' }}
                wrapperClassName="recipe-editor-positions-wrap"
                emptyText="Brak pozycji."
              />
            </div>
            <button type="button" className="btn btn-success" style={{ marginTop: 10 }} onClick={() => set({ items: [...form.items, { component_id: 0, quantity: 1, uwagi: '' }] })} disabled={saving}>
              + Dodaj pozycję
            </button>
          </div>
        </div>
        <div className="order-form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Wystawianie…' : 'Wystaw WZ i pobierz PDF'}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose} disabled={saving}>Anuluj</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
