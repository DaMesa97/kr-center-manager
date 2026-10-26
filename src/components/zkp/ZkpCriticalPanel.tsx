import { useMemo, useState } from 'react'
import DataTable, { type DataTableColumn } from '../DataTable'
import ZkpModal from './ZkpModal'
import { ZKP_CRITICAL_KIND_LABELS, type ZkpComponent, type ZkpCriticalKind } from '../../lib/zkp'
import type { ZkpData } from './ZkpView'

const PAGE_LIMIT = 300

export default function ZkpCriticalPanel({ zkp, canEdit }: { zkp: ZkpData; canEdit: boolean }) {
  const [onlyCritical, setOnlyCritical] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ZkpComponent | null>(null)

  const criticalCount = useMemo(() => zkp.components.filter((c) => c.zkp_critical_kind).length, [zkp.components])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return zkp.components.filter((c) => {
      if (onlyCritical && !c.zkp_critical_kind) return false
      if (!onlyCritical && !q) return !!c.zkp_critical_kind || c.is_active
      if (!q) return true
      return [c.name, c.code, c.category, c.zkp_model, c.zkp_dwu_number].some((v) => String(v ?? '').toLowerCase().includes(q))
    })
  }, [zkp.components, onlyCritical, search])
  // pełna kartoteka to kilka tysięcy pozycji — bez wyszukiwania pokazujemy pierwsze PAGE_LIMIT
  const rows = filtered.slice(0, PAGE_LIMIT)

  const columns = useMemo<DataTableColumn<ZkpComponent>[]>(
    () => [
      {
        key: 'name',
        label: 'KOMPONENT',
        headerSub: 'KOD · KATEGORIA',
        sortValue: (c) => c.name,
        render: (c) => (
          <>
            <div>
              {c.name}
              {!c.is_active && <span className="dt-stack-sub"> (nieaktywny)</span>}
            </div>
            <div className="dt-stack-sub">{[c.code, c.category].filter(Boolean).join(' · ') || '—'}</div>
          </>
        ),
      },
      {
        key: 'kind',
        label: 'RODZAJ (6.10.5)',
        sortValue: (c) => c.zkp_critical_kind ?? '',
        render: (c) =>
          c.zkp_critical_kind ? (
            <span className="zkp-decision zkp-decision--kwarantanna">{ZKP_CRITICAL_KIND_LABELS[c.zkp_critical_kind]}</span>
          ) : (
            <span className="zkp-missing">nie krytyczny</span>
          ),
      },
      { key: 'model', label: 'MODEL', sortValue: (c) => c.zkp_model, render: (c) => c.zkp_model || '—' },
      { key: 'dwu', label: 'NR DWU (OKUCIA)', sortValue: (c) => c.zkp_dwu_number, render: (c) => c.zkp_dwu_number || '—' },
      {
        key: 'actions',
        label: '',
        stopRowClick: true,
        render: (c) =>
          canEdit ? (
            <button type="button" className="btn btn-sm btn-secondary" disabled={zkp.saving} onClick={() => setEditing(c)}>
              {c.zkp_critical_kind ? 'Edytuj' : '+ Krytyczny'}
            </button>
          ) : null,
      },
    ],
    [canEdit, zkp.saving],
  )

  return (
    <div>
      <div className="orders-filters zkp-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj w kartotece: nazwa, kod, model…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 280 }}
        />
        <label className="orders-filter-checkbox">
          <input type="checkbox" checked={onlyCritical} onChange={(e) => setOnlyCritical(e.target.checked)} /> Tylko krytyczne ({criticalCount})
        </label>
        {!canEdit && <span className="zkp-hint">Listę 6.10.5 prowadzi Pełnomocnik ZKP / Zastępca.</span>}
        {canEdit && onlyCritical && (
          <span className="zkp-hint">Odznacz „Tylko krytyczne” i wyszukaj komponent w kartotece, żeby dodać go do listy.</span>
        )}
      </div>

      <DataTable
        rows={rows}
        rowKey={(c) => c.id}
        columns={columns}
        loading={zkp.loading}
        emptyText={onlyCritical ? 'Lista komponentów krytycznych jest pusta.' : 'Brak komponentów pasujących do wyszukiwania.'}
      />
      {filtered.length > PAGE_LIMIT && (
        <p className="zkp-hint">
          Pokazano {PAGE_LIMIT} z {filtered.length} — zawęź wyszukiwanie.
        </p>
      )}

      {editing && <CriticalModal zkp={zkp} component={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function CriticalModal({ zkp, component, onClose }: { zkp: ZkpData; component: ZkpComponent; onClose: () => void }) {
  const [kind, setKind] = useState<ZkpCriticalKind | ''>(component.zkp_critical_kind ?? '')
  const [model, setModel] = useState(component.zkp_model)
  const [dwu, setDwu] = useState(component.zkp_dwu_number)

  const save = async () => {
    if (await zkp.setComponentCritical(component.id, kind || null, model, dwu)) onClose()
  }

  return (
    <ZkpModal
      title={`Lista komponentów krytycznych (6.10.5) — ${component.name}`}
      onClose={onClose}
      busy={zkp.saving}
      width={560}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={zkp.saving} onClick={() => void save()}>
            {zkp.saving ? 'Zapisuję…' : 'Zapisz'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={zkp.saving}>
            Anuluj
          </button>
        </>
      }
    >
      <div className="order-form-grid zkp-form-grid">
        <label>
          <span className="order-field-label-text">Rodzaj</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ZkpCriticalKind | '')}>
            <option value="">— nie krytyczny (zdejmij z listy) —</option>
            {(Object.keys(ZKP_CRITICAL_KIND_LABELS) as ZkpCriticalKind[]).map((k) => (
              <option key={k} value={k}>
                {ZKP_CRITICAL_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="order-field-label-text">Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Nr DWU (okucia)</span>
          <input value={dwu} onChange={(e) => setDwu(e.target.value)} />
        </label>
      </div>
      {!kind && component.zkp_critical_kind && (
        <div className="zkp-warnbox">Zdjęcie z listy blokuje rejestrowanie nowych przyjęć tego komponentu jako krytycznego. Historia przyjęć zostaje.</div>
      )}
    </ZkpModal>
  )
}
