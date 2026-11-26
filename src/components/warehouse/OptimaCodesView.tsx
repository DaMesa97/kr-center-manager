import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { fetchAllPages } from '../../lib/fetchPaged'
import { componentLabel } from '../../lib/componentLabel'
import { groupUnmappedCodes, mapOptimaCode, type OptimaMapRow } from '../../lib/optimaRo'
import { internalDoorComponents } from '../../lib/internalWarehouse'
import DataTable, { type DataTableColumn } from '../DataTable'
import ComponentPickerDialog from '../ComponentPickerDialog'
import OptimaCodeLinkDialog from '../OptimaCodeLinkDialog'
import Spinner from '../Spinner'
import type { InternalDoorItem, ToastVariant, WarehouseComponent } from '../../types'

type Props = {
  components: WarehouseComponent[]
  /** zapis do optima_component_map — rola z polityki ocm_write */
  canEdit: boolean
  pushToast: (message: string, variant: ToastVariant) => void
}

type ItemRow = Pick<InternalDoorItem, 'optima_code' | 'optima_name' | 'optima_group' | 'order_id' | 'component_id'>
type MappedRow = OptimaMapRow & { name: string; count: number }

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Magazyn → Komponenty → Kody Optimy. Pozycje RO z Optimy mają kod towaru;
 * komponent magazynu dopina import z optima_component_map (albo po
 * warehouse_components.code = kod). Tu: kody bez komponentu (masowe
 * przypisanie) i podgląd / zmiana istniejących powiązań.
 */
export default function OptimaCodesView({ components, canEdit, pushToast }: Props) {
  const [items, setItems] = useState<ItemRow[]>([])
  const [mapRows, setMapRows] = useState<OptimaMapRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** kod → wybrany (jeszcze niezapisany) komponent */
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [picker, setPicker] = useState<{ codes: string[] } | null>(null)
  const [editCode, setEditCode] = useState<{ code: string; name: string; group: string; currentId: number | null } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [it, mp] = await Promise.all([
      fetchAllPages<ItemRow>((from, to) =>
        supabase
          .from('order_internal_door_items')
          .select('id, optima_code, optima_name, optima_group, order_id, component_id')
          .not('optima_code', 'is', null)
          .order('id')
          .range(from, to),
      ),
      fetchAllPages<OptimaMapRow>((from, to) =>
        supabase.from('optima_component_map').select('*').order('optima_code').range(from, to),
      ),
    ])
    setLoading(false)
    if (it.error || mp.error) {
      const msg = (it.error ?? mp.error)!.message
      console.error('[optima] kody', it.error ?? mp.error)
      pushToast(`Nie wczytano kodów Optimy: ${msg}`, 'error')
      return
    }
    setItems(it.data)
    setMapRows(mp.data)
  }, [pushToast])

  useEffect(() => {
    void load()
  }, [load])

  const componentById = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])
  // do wyboru tylko drzwi wewnętrzne — bez surowców i bez Bastiona (osobny produkt)
  const doorComponents = useMemo(() => internalDoorComponents(components), [components])

  const unmapped = useMemo(() => groupUnmappedCodes(items.filter((r) => r.component_id == null)), [items])

  const mapped = useMemo<MappedRow[]>(() => {
    const names = new Map<string, string>()
    const counts = new Map<string, number>()
    for (const r of items) {
      const c = String(r.optima_code ?? '')
      if (!names.has(c) && r.optima_name) names.set(c, r.optima_name)
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return mapRows.map((m) => ({ ...m, name: names.get(m.optima_code) ?? '', count: counts.get(m.optima_code) ?? 0 }))
  }, [items, mapRows])

  const q = fold(query.trim())
  const match = (...vals: Array<string | null | undefined>) => !q || fold(vals.filter(Boolean).join(' ')).includes(q)
  const unmappedShown = unmapped.filter((u) => match(u.code, u.sampleName, u.group))
  const mappedShown = mapped.filter((m) => {
    const c = componentById.get(m.component_id)
    return match(m.optima_code, m.name, c?.code, c ? componentLabel(c) : '')
  })

  const draftCount = Object.keys(drafts).length

  const saveDrafts = async () => {
    const entries = Object.entries(drafts)
    if (entries.length === 0) return
    setSaving(true)
    let ok = 0
    let moved = 0
    const failed: string[] = []
    for (const [code, componentId] of entries) {
      try {
        moved += await mapOptimaCode(code, componentId)
        ok += 1
      } catch (e) {
        console.error('[optima] powiązanie', code, e)
        failed.push(`${code}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setSaving(false)
    if (ok > 0) pushToast(`Zapisano powiązań: ${ok} — przepięto pozycji: ${moved}`, 'success')
    if (failed.length > 0) pushToast(`Nie zapisano ${failed.length}: ${failed.join('; ')}`, 'error')
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([code]) => failed.some((f) => f.startsWith(`${code}:`)))))
    setSelected(new Set())
    await load()
  }

  const toggle = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })

  const unmappedColumns: DataTableColumn<(typeof unmapped)[number]>[] = [
    ...(canEdit
      ? [
          {
            key: 'sel',
            label: (
              <input
                type="checkbox"
                aria-label="Zaznacz wszystkie"
                checked={unmappedShown.length > 0 && unmappedShown.every((u) => selected.has(u.code))}
                onChange={(e) => setSelected(e.target.checked ? new Set(unmappedShown.map((u) => u.code)) : new Set())}
              />
            ),
            stopRowClick: true,
            render: (u: (typeof unmapped)[number]) => (
              <input type="checkbox" aria-label={`Zaznacz ${u.code}`} checked={selected.has(u.code)} onChange={() => toggle(u.code)} />
            ),
          } satisfies DataTableColumn<(typeof unmapped)[number]>,
        ]
      : []),
    { key: 'code', label: 'KOD OPTIMY', sortValue: (u) => u.code, render: (u) => <span className="optima-code">{u.code}</span> },
    { key: 'name', label: 'NAZWA (PRZYKŁAD)', sortValue: (u) => u.sampleName, render: (u) => u.sampleName || '—' },
    { key: 'group', label: 'GRUPA', sortValue: (u) => u.group, render: (u) => u.group || '—' },
    { key: 'count', label: 'POZYCJI', align: 'right', sortValue: (u) => u.count, render: (u) => u.count },
    { key: 'orders', label: 'ZLECEŃ', align: 'right', sortValue: (u) => u.orders, render: (u) => u.orders },
    {
      key: 'component',
      label: 'KOMPONENT MAGAZYNU',
      stopRowClick: true,
      render: (u) => {
        const draft = drafts[u.code]
        const comp = draft != null ? componentById.get(draft) : undefined
        if (!canEdit) return <span className="optima-unmapped-badge">⚠ brak</span>
        return (
          <div className="optima-item-link">
            {comp ? (
              <span className="optima-draft" title="Wybrane — jeszcze niezapisane">
                {comp.code ? `${comp.code} · ` : ''}
                {componentLabel(comp)}
              </span>
            ) : (
              <span className="optima-unmapped-badge">⚠ brak</span>
            )}
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setPicker({ codes: [u.code] })}>
              {comp ? 'Zmień' : 'Wybierz…'}
            </button>
            {comp && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([code]) => code !== u.code)))}
                title="Odrzuć wybór"
              >
                ✕
              </button>
            )}
          </div>
        )
      },
    },
  ]

  const mappedColumns: DataTableColumn<MappedRow>[] = [
    { key: 'code', label: 'KOD OPTIMY', sortValue: (m) => m.optima_code, render: (m) => <span className="optima-code">{m.optima_code}</span> },
    { key: 'name', label: 'NAZWA W OPTIMIE', sortValue: (m) => m.name, render: (m) => m.name || <span className="muted">— (brak pozycji z tym kodem)</span> },
    {
      key: 'component',
      label: 'KOMPONENT MAGAZYNU',
      sortValue: (m) => componentById.get(m.component_id)?.name ?? '',
      render: (m) => {
        const c = componentById.get(m.component_id)
        return c ? `${c.code ? `${c.code} · ` : ''}${componentLabel(c)}` : `#${m.component_id}`
      },
    },
    { key: 'count', label: 'POZYCJI', align: 'right', sortValue: (m) => m.count, render: (m) => m.count },
    {
      key: 'created',
      label: 'POWIĄZANO',
      sortValue: (m) => m.created_at,
      render: (m) => (m.created_at ? new Date(m.created_at).toLocaleDateString('pl-PL') : '—'),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            label: '',
            stopRowClick: true,
            render: (m: MappedRow) => (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setEditCode({ code: m.optima_code, name: m.name, group: '', currentId: m.component_id })}
              >
                Zmień / usuń
              </button>
            ),
          } satisfies DataTableColumn<MappedRow>,
        ]
      : []),
  ]

  if (loading && items.length === 0 && mapRows.length === 0) return <Spinner center label="Wczytywanie kodów Optimy…" />

  return (
    <div className="optima-codes-view">
      <p className="muted" style={{ marginTop: 0 }}>
        Pozycje zleceń drzwi wewnętrznych z Optimy mają kod towaru. Powiąż kod z komponentem magazynu raz — wszystkie pozycje z tym
        kodem dostaną komponent od razu, a import zastosuje powiązanie przy kolejnych RO. Pozycje bez komponentu są pomijane przy wydaniu z
        magazynu.
        {!canEdit && ' Powiązania zmienia kierownik albo magazynier.'}
      </p>
      <div className="optima-codes-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj: kod, nazwa, grupa, komponent…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} disabled={loading}>
          {loading ? 'Odświeżam…' : 'Odśwież'}
        </button>
      </div>

      <h3 className="optima-codes-title">
        Kody bez komponentu <span className="optima-unmapped-badge">{unmapped.length}</span>
      </h3>
      {canEdit && (selected.size > 0 || draftCount > 0) && (
        <div className="optima-codes-bulk">
          {selected.size > 0 && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setPicker({ codes: [...selected] })}>
              Przypisz zaznaczonym ({selected.size}) jeden komponent…
            </button>
          )}
          {draftCount > 0 && (
            <>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveDrafts()} disabled={saving}>
                {saving ? 'Zapisywanie…' : `Zapisz powiązania (${draftCount})`}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDrafts({})} disabled={saving}>
                Odrzuć wybory
              </button>
            </>
          )}
        </div>
      )}
      <DataTable
        rows={unmappedShown}
        rowKey={(u) => u.code}
        columns={unmappedColumns}
        wrapperClassName="orders-table-wrapper"
        emptyText={unmapped.length === 0 ? 'Wszystkie kody z Optimy mają komponent' : 'Brak kodów dla wyszukiwania'}
        rowClassName={(u) => `orders-table-row${drafts[u.code] != null ? ' optima-row--draft' : ''}`}
      />

      <h3 className="optima-codes-title">
        Powiązane kody <span className="muted">({mapped.length})</span>
      </h3>
      <DataTable
        rows={mappedShown}
        rowKey={(m) => m.optima_code}
        columns={mappedColumns}
        wrapperClassName="orders-table-wrapper"
        emptyText={mapped.length === 0 ? 'Nie ma jeszcze ręcznych powiązań (import dopina też po kodzie komponentu)' : 'Brak powiązań dla wyszukiwania'}
      />

      {picker && (
        <ComponentPickerDialog
          title={picker.codes.length > 1 ? `Jeden komponent dla ${picker.codes.length} kodów` : `Komponent dla kodu ${picker.codes[0]}`}
          subject={
            <div className="muted">
              {picker.codes.length > 1
                ? `Kody: ${picker.codes.join(', ')}`
                : unmapped.find((u) => u.code === picker.codes[0])?.sampleName ?? ''}
              <div>Wybór trafia na listę — zapisujesz przyciskiem „Zapisz powiązania”.</div>
            </div>
          }
          components={doorComponents}
          initialQuery={
            picker.codes.length === 1
              ? String(unmapped.find((u) => u.code === picker.codes[0])?.sampleName ?? '').split(/\s+/).filter((w) => w.length > 2).slice(0, 2).join(' ')
              : ''
          }
          currentId={picker.codes.length === 1 ? drafts[picker.codes[0]] ?? null : null}
          confirmLabel="Wybierz"
          onPick={(c) => {
            setDrafts((prev) => ({ ...prev, ...Object.fromEntries(picker.codes.map((code) => [code, c.id])) }))
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}

      {editCode && (
        <OptimaCodeLinkDialog
          code={editCode.code}
          name={editCode.name}
          group={editCode.group}
          components={components}
          currentId={editCode.currentId}
          pushToast={pushToast}
          onDone={load}
          onClose={() => setEditCode(null)}
        />
      )}
    </div>
  )
}
