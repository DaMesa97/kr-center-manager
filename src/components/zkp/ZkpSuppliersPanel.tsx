import { useMemo, useState } from 'react'
import DataTable, { type DataTableColumn } from '../DataTable'
import ZkpModal from './ZkpModal'
import {
  ZKP_ASSESSMENT_KIND_LABELS,
  ZKP_ASSESSMENT_RESULT_LABELS,
  zkpSupplierState,
  type ZkpAssessmentKind,
  type ZkpAssessmentResult,
  type ZkpSupplierAssessment,
  type ZkpSupplierQualification,
  type ZkpSupplierState,
} from '../../lib/zkp'
import type { ZkpData } from './ZkpView'

type Row = {
  id: number
  name: string
  is_active: boolean
  qualification: ZkpSupplierQualification | undefined
  assessments: ZkpSupplierAssessment[]
  state: ZkpSupplierState
}

const today = () => new Date().toLocaleDateString('sv-SE')
const fmtDate = (ymd: string | null | undefined) => (ymd ? ymd.slice(0, 10).split('-').reverse().join('.') : '—')
const plusYear = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y + 1, m - 1, d).toLocaleDateString('sv-SE')
}

export default function ZkpSuppliersPanel({ zkp, canEdit }: { zkp: ZkpData; canEdit: boolean }) {
  const [onlyListed, setOnlyListed] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [qualifyFor, setQualifyFor] = useState<Row | null>(null)
  const [assessFor, setAssessFor] = useState<Row | null>(null)

  const rows = useMemo<Row[]>(() => {
    const t = today()
    const q = search.trim().toLowerCase()
    return zkp.suppliers
      .map((s) => {
        const qualification = zkp.qualifications.find((x) => x.supplier_id === s.id)
        const assessments = zkp.assessments.filter((a) => a.supplier_id === s.id)
        return { ...s, qualification, assessments, state: zkpSupplierState(qualification, assessments, t) }
      })
      .filter((r) => (onlyListed ? r.state.onList : r.is_active || r.state.onList))
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.state.onList) - Number(a.state.onList) || a.name.localeCompare(b.name, 'pl'))
  }, [zkp.suppliers, zkp.qualifications, zkp.assessments, onlyListed, search])

  const columns = useMemo<DataTableColumn<Row>[]>(
    () => [
      {
        key: 'name',
        label: 'DOSTAWCA',
        sortValue: (r) => r.name,
        render: (r) => (
          <>
            <span className="my-station-expand-icon">{expanded === r.id ? '▾' : '▸'}</span> {r.name}
            {!r.is_active && <span className="dt-stack-sub"> (nieaktywny)</span>}
          </>
        ),
      },
      {
        key: 'status',
        label: 'STATUS (6.31)',
        sortValue: (r) => (r.state.qualified ? 2 : r.state.onList ? 1 : 0),
        render: (r) =>
          r.state.qualified ? (
            <span className="zkp-decision zkp-decision--przyjeto">Kwalifikowany</span>
          ) : r.state.onList ? (
            <span className="zkp-decision zkp-decision--zwrot" title="Ostatnia ocena negatywna albo brak oceny">
              Niekwalifikowany
            </span>
          ) : (
            <span className="zkp-missing">spoza wykazu</span>
          ),
      },
      {
        key: 'scope',
        label: 'ZAKRES',
        headerSub: 'WYMAGANY DOKUMENT JAKOŚCI',
        render: (r) =>
          r.qualification ? (
            <>
              <div>
                {r.qualification.scope || '—'}
                {r.qualification.is_critical ? ' · krytyczny' : ''}
              </div>
              <div className="dt-stack-sub">{r.qualification.required_quality_doc || '—'}</div>
            </>
          ) : (
            '—'
          ),
      },
      {
        key: 'last',
        label: 'OSTATNIA OCENA',
        sortValue: (r) => r.state.last?.assessed_on ?? '',
        render: (r) =>
          r.state.last ? (
            <>
              <div>
                {fmtDate(r.state.last.assessed_on)} · {ZKP_ASSESSMENT_RESULT_LABELS[r.state.last.result]}
              </div>
              <div className="dt-stack-sub">
                {ZKP_ASSESSMENT_KIND_LABELS[r.state.last.kind]} · {r.state.last.created_by_name}
              </div>
            </>
          ) : (
            '—'
          ),
      },
      {
        key: 'next',
        label: 'NASTĘPNA OCENA',
        sortValue: (r) => r.state.nextDue ?? '9999',
        render: (r) => (
          <span className={r.state.dueStatus === 'overdue' ? 'zkp-due zkp-due--overdue' : r.state.dueStatus === 'soon' ? 'zkp-due zkp-due--soon' : ''}>
            {fmtDate(r.state.nextDue)}
            {r.state.dueStatus === 'overdue' ? ' — po terminie' : r.state.dueStatus === 'soon' ? ' — wkrótce' : ''}
          </span>
        ),
      },
      {
        key: 'actions',
        label: '',
        stopRowClick: true,
        render: (r) =>
          canEdit ? (
            <span className="zkp-actions">
              <button type="button" className="btn btn-sm btn-secondary" disabled={zkp.saving} onClick={() => setQualifyFor(r)}>
                {r.state.onList ? 'Wykaz…' : '+ Na wykaz'}
              </button>
              {r.state.onList && (
                <button type="button" className="btn btn-sm btn-primary" disabled={zkp.saving} onClick={() => setAssessFor(r)}>
                  + Ocena
                </button>
              )}
            </span>
          ) : null,
      },
    ],
    [expanded, canEdit, zkp.saving],
  )

  const due = rows.filter((r) => r.state.onList && (r.state.dueStatus === 'overdue' || r.state.dueStatus === 'soon')).length

  return (
    <div>
      <div className="orders-filters zkp-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj dostawcy…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <label className="orders-filter-checkbox">
          <input type="checkbox" checked={onlyListed} onChange={(e) => setOnlyListed(e.target.checked)} /> Tylko na wykazie
        </label>
        {due > 0 && <span className="zkp-due zkp-due--soon">Oceny okresowe do zrobienia: {due}</span>}
        {!canEdit && <span className="zkp-hint">Wykaz i oceny prowadzi Pełnomocnik ZKP / Zastępca.</span>}
      </div>

      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        loading={zkp.loading}
        emptyText="Brak dostawców. Dodaje ich admin w Konfiguracja → Dostawcy."
        onRowClick={(r) => setExpanded(expanded === r.id ? null : r.id)}
        renderAfterRow={(r) =>
          expanded === r.id ? (
            <tr className="my-station-details-row">
              <td colSpan={columns.length}>
                {r.assessments.length === 0 ? (
                  <span className="zkp-hint">Brak ocen.</span>
                ) : (
                  <table className="zkp-history">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Rodzaj</th>
                        <th>Wynik</th>
                        <th>Uwagi</th>
                        <th>Następna</th>
                        <th>Kto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...r.assessments]
                        .sort((a, b) => b.assessed_on.localeCompare(a.assessed_on) || b.id - a.id)
                        .map((a) => (
                          <tr key={a.id}>
                            <td>{fmtDate(a.assessed_on)}</td>
                            <td>{ZKP_ASSESSMENT_KIND_LABELS[a.kind]}</td>
                            <td>{ZKP_ASSESSMENT_RESULT_LABELS[a.result]}</td>
                            <td>{a.notes || '—'}</td>
                            <td>{fmtDate(a.next_assessment_on)}</td>
                            <td>{a.created_by_name || '—'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </td>
            </tr>
          ) : null
        }
      />

      {qualifyFor && <QualifyModal zkp={zkp} row={qualifyFor} onClose={() => setQualifyFor(null)} />}
      {assessFor && <AssessModal zkp={zkp} row={assessFor} onClose={() => setAssessFor(null)} />}
    </div>
  )
}

function QualifyModal({ zkp, row, onClose }: { zkp: ZkpData; row: Row; onClose: () => void }) {
  const [scope, setScope] = useState(row.qualification?.scope ?? '')
  const [critical, setCritical] = useState(row.qualification?.is_critical ?? true)
  const [doc, setDoc] = useState(row.qualification?.required_quality_doc ?? '')

  const save = async () => {
    if (await zkp.upsertQualification(row.id, scope, critical, doc)) onClose()
  }

  return (
    <ZkpModal
      title={`Wykaz dostawców kwalifikowanych — ${row.name}`}
      onClose={onClose}
      busy={zkp.saving}
      width={560}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={zkp.saving || !scope.trim()} onClick={() => void save()}>
            {zkp.saving ? 'Zapisuję…' : 'Zapisz'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={zkp.saving}>
            Anuluj
          </button>
        </>
      }
    >
      {!row.state.onList && (
        <p className="zkp-hint">Po dodaniu na wykaz dostawca będzie kwalifikowany dopiero po ocenie wstępnej (pozytywnej lub warunkowej).</p>
      )}
      <label className="order-field-full">
        <span className="order-field-label-text">Zakres dostaw *</span>
        <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="np. uszczelki pęczniejące, szkło EI30" />
      </label>
      <label className="order-field-full">
        <span className="order-field-label-text">Wymagany dokument jakości</span>
        <input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="np. Deklaracja właściwości użytkowych" />
      </label>
      <label className="orders-filter-checkbox">
        <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} /> Dostawca komponentów krytycznych
      </label>
    </ZkpModal>
  )
}

function AssessModal({ zkp, row, onClose }: { zkp: ZkpData; row: Row; onClose: () => void }) {
  const [kind, setKind] = useState<ZkpAssessmentKind>(row.assessments.length ? 'okresowa' : 'wstepna')
  const [on, setOn] = useState(today())
  const [result, setResult] = useState<ZkpAssessmentResult>('pozytywna')
  const [notes, setNotes] = useState('')
  const [next, setNext] = useState(plusYear(today()))

  const save = async () => {
    if (await zkp.addAssessment(row.id, kind, on, result, notes, next || null)) onClose()
  }

  return (
    <ZkpModal
      title={`Ocena dostawcy — ${row.name}`}
      onClose={onClose}
      busy={zkp.saving}
      width={560}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={zkp.saving || !on} onClick={() => void save()}>
            {zkp.saving ? 'Zapisuję…' : 'Zapisz ocenę'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={zkp.saving}>
            Anuluj
          </button>
        </>
      }
    >
      <p className="zkp-hint">Ocen nie da się edytować ani usuwać — kolejna ocena tworzy nowy wpis w historii.</p>
      <div className="order-form-grid zkp-form-grid">
        <label>
          <span className="order-field-label-text">Rodzaj</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ZkpAssessmentKind)}>
            <option value="wstepna">Wstępna</option>
            <option value="okresowa">Okresowa</option>
          </select>
        </label>
        <label>
          <span className="order-field-label-text">Data oceny</span>
          <input
            type="date"
            value={on}
            onChange={(e) => {
              setOn(e.target.value)
              if (e.target.value) setNext(plusYear(e.target.value))
            }}
          />
        </label>
        <label>
          <span className="order-field-label-text">Wynik</span>
          <select value={result} onChange={(e) => setResult(e.target.value as ZkpAssessmentResult)}>
            <option value="pozytywna">Pozytywna</option>
            <option value="warunkowa">Warunkowa</option>
            <option value="negatywna">Negatywna (wypada z kwalifikowanych)</option>
          </select>
        </label>
        <label>
          <span className="order-field-label-text">Następna ocena</span>
          <input type="date" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
      </div>
      <label className="order-field-full">
        <span className="order-field-label-text">Uwagi</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </ZkpModal>
  )
}
