import { useEffect, useMemo, useState } from 'react'
import ZkpModal from './ZkpModal'
import { appConfirm, appPrompt } from '../../lib/appDialogs'
import { useZkpCard, type ZkpCardApi } from '../../hooks/useZkpCards'
import {
  ZKP_EVACUATION_LABELS,
  ZKP_FILLING_FIELDS,
  ZKP_GAP_SIDES,
  ZKP_HARDWARE_SLOTS,
  ZKP_LIGHT_LABELS,
  ZKP_OPENING_LABELS,
  ZKP_PRODUCT_TYPE_LABELS,
  ZKP_STAGES,
  cardToForm,
  latestBy,
  lotsForStage,
  peopleWithCompetency,
  requiredFillingFields,
  zkpTypeCode,
  type ZkpCardForm,
  type ZkpFillingField,
  type ZkpGaps,
  type ZkpHardwareSlot,
  type ZkpStageDef,
  type ZkpStageResult,
} from '../../lib/zkpCard'
import { printProductCardPdf, printProtocolPdf } from '../../utils/zkpPdf'
import ZkpProtocolSection from './ZkpProtocolSection'
import type { ZkpData } from './ZkpView'
import type { ToastVariant } from '../../types'

// Karta wyrobu AS 75EI (zał. 6.25) jednej konstrukcji. Sekcje jak na wzorze:
// A+B identyfikacja i sprawdzenie zakresu (tabela K, liczy baza), C etapy z partiami,
// D okucia, E wypełnienia, F zwolnienie, G protokół badań 6.17.5 (zwolnienie idzie
// przez protokół). Każda reguła jest też w bazie — okno tylko podpowiada i pokazuje
// odpowiedź bazy.

export type ZkpCardTarget = {
  constructionId: number
  constructionNo: string
  orderNumber: string
  company: string
  /** podpowiedź z pozycji LP (typ, wymiary konstrukcji) */
  position?: { pos_no: number; description: string; system: string; construction_type: string; width_mm: number | null; height_mm: number | null } | null
}

type Props = {
  target: ZkpCardTarget
  zkp: ZkpData
  roles: string[]
  isManager: boolean
  onClose: () => void
  onChanged?: () => void
  pushToast: (message: string, variant: ToastVariant) => void
}

type Section = 'ab' | 'c' | 'd' | 'e' | 'g' | 'f'

const hasAny = (roles: string[], wanted: string[]) => roles.some((r) => wanted.includes(r))

function fmt(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

export default function ZkpCardModal({ target, zkp, roles, isManager, onClose, onChanged, pushToast }: Props) {
  const api = useZkpCard(target.constructionId, pushToast)
  const [section, setSection] = useState<Section>('ab')
  const card = api.data?.card ?? null
  // jak w bazie: A/B — zkp_can_fill_card; etapy, okucia, wypełnienia — zkp_can_record_card (+ operator produkcji)
  const canFill = isManager || hasAny(roles, ['pelnomocnik', 'zastepca', 'kierownik_produkcji', 'kontroler'])
  const canRecord = canFill || roles.includes('operator')
  const canConfirm = hasAny(roles, ['pelnomocnik', 'zastepca', 'kierownik_produkcji'])
  const canDecide = hasAny(roles, ['pelnomocnik', 'zastepca'])
  const confirmed = !!card?.range_confirmed_at
  const closed = !!card?.decision

  // operator produkcji (konto hali) od razu na etapach, gdy zakres jest potwierdzony
  const operatorOnly = canRecord && !canFill
  useEffect(() => {
    if (operatorOnly && confirmed) setSection((s) => (s === 'ab' ? 'c' : s))
  }, [operatorOnly, confirmed])

  const wrap = <A extends unknown[]>(fn: (...a: A) => Promise<boolean>) => async (...a: A) => {
    const ok = await fn(...a)
    if (ok) onChanged?.()
    return ok
  }

  const tab = (key: Section, label: string, disabled = false) => (
    <button
      type="button"
      role="tab"
      aria-selected={section === key}
      disabled={disabled}
      className={`btn btn-sm ${section === key ? 'btn-primary' : 'btn-secondary'}`}
      onClick={() => setSection(key)}
    >
      {label}
    </button>
  )

  const status = !card ? 'nowa karta' : closed ? (card.decision === 'zwolniony' ? 'ZWOLNIONY' : 'NIEZGODNY') : confirmed ? 'zakres potwierdzony — produkcja' : 'szkic'

  return (
    <ZkpModal
      title={`Karta wyrobu ${target.constructionNo} — ${target.orderNumber}`}
      onClose={onClose}
      busy={api.saving}
      width={1080}
      footer={
        <>
          {card && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginRight: 'auto' }}
              onClick={() => api.data && printProductCardPdf(target, api.data, api.ranges, zkp)}
            >
              🖨 Drukuj kartę (PDF)
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={api.saving}>
            Zamknij
          </button>
        </>
      }
    >
      <div className="zkp-card-head">
        <span className="zkp-trace-no" style={{ fontSize: '1.3rem' }}>{target.constructionNo}</span>
        <span>{target.company || '—'}</span>
        {target.position && (
          <span className="zkp-hint" style={{ margin: 0 }}>
            poz. {target.position.pos_no} · {target.position.system} · {target.position.width_mm ?? '?'}×{target.position.height_mm ?? '?'} mm (wymiary konstrukcji z LP)
          </span>
        )}
        <span className={closed ? (card?.decision === 'zwolniony' ? 'badge badge-success' : 'badge badge-danger') : confirmed ? 'badge badge-warning' : 'badge badge-neutral'}>
          {status}
        </span>
        {card?.type_code && <code className="zkp-type-code">{card.type_code}</code>}
      </div>

      <div className="subtab-bar" role="tablist" aria-label="Części karty">
        {tab('ab', 'A–B. Identyfikacja i zakres')}
        {tab('c', 'C. Etapy i partie', !confirmed)}
        {tab('d', 'D. Okucia', !card)}
        {tab('e', 'E. Wypełnienia', !card)}
        {tab('g', `G. Protokół 6.17.5${(api.data?.protocols.length ?? 0) ? ` (${api.data?.protocols.length})` : ''}`, !confirmed)}
        {tab('f', 'F. Zwolnienie', !card)}
      </div>

      {!api.data ? (
        <p className="zkp-hint">Wczytuję kartę…</p>
      ) : section === 'ab' ? (
        <SectionAB api={api} target={target} canFill={canFill && !closed} canConfirm={canConfirm} onChanged={onChanged} />
      ) : section === 'c' ? (
        <SectionC api={api} zkp={zkp} canFill={canRecord && !closed} save={wrap(api.recordStage)} />
      ) : section === 'd' ? (
        <SectionD api={api} zkp={zkp} canFill={canRecord && !closed} save={wrap(api.saveHardware)} />
      ) : section === 'e' ? (
        <SectionE api={api} zkp={zkp} canFill={canRecord && !closed} save={wrap(api.saveFilling)} />
      ) : section === 'g' ? (
        <ZkpProtocolSection api={api} zkp={zkp} target={target} canFill={canFill} canDecide={canDecide} />
      ) : (
        <SectionF api={api} target={target} canDecide={canDecide && !closed} save={wrap(api.decide)} onGoProtocol={() => setSection('g')} />
      )}
    </ZkpModal>
  )
}

// ── A + B ────────────────────────────────────────────────────────────────
function SectionAB({ api, target, canFill, canConfirm, onChanged }: {
  api: ZkpCardApi; target: ZkpCardTarget; canFill: boolean; canConfirm: boolean; onChanged?: () => void
}) {
  const card = api.data?.card ?? null
  const confirmed = !!card?.range_confirmed_at
  const [f, setF] = useState<ZkpCardForm>(() => cardToForm(card))
  useEffect(() => {
    setF(cardToForm(card))
  }, [card, target.position])
  const set = <K extends keyof ZkpCardForm>(k: K, v: ZkpCardForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const editable = canFill && !confirmed
  const range = api.ranges.find((r) => r.code === f.range_code)
  const lightAllowed = !range || (f.light === 'nadswietle' ? range.transom_w != null : f.light === 'brak' ? true : range.side_w != null)
  const checks = api.data?.checks ?? []
  const allOk = checks.length > 0 && checks.every((c) => c.r_ok)

  const save = async () => {
    if (await api.saveAB(f)) onChanged?.()
  }
  const confirm = async () => {
    const ok = await appConfirm(
      `Potwierdzić zakres konstrukcji ${target.constructionNo} (${card?.type_code})? Po potwierdzeniu część A/B jest zablokowana, a produkcja może wpisywać etapy.`,
      { title: 'Sprawdzenie zakresu — zał. 6.25 cz. B', confirmLabel: 'Potwierdzam zakres' },
    )
    if (ok && (await api.confirmRange())) onChanged?.()
  }
  const reopen = async () => {
    const reason = await appPrompt('Powód cofnięcia potwierdzenia zakresu (np. zmiana wymiarów u klienta):', {
      title: 'Cofnięcie potwierdzenia zakresu',
      confirmLabel: 'Cofnij potwierdzenie',
    })
    if (reason != null && (await api.reopenRange(reason))) onChanged?.()
  }

  const radio = <K extends keyof ZkpCardForm>(k: K, options: Array<[ZkpCardForm[K], string]>) => (
    <span className="zkp-decision-pick">
      {options.map(([v, label]) => (
        <label key={String(v)}>
          <input type="radio" disabled={!editable} checked={f[k] === v} onChange={() => set(k, v)} /> {label}
        </label>
      ))}
    </span>
  )
  const num = (k: keyof ZkpCardForm, label: string, unit = 'mm', disabled = false) => (
    <label>
      <span className="order-field-label-text">{label} [{unit}]</span>
      <input inputMode="decimal" disabled={!editable || disabled} value={String(f[k])} onChange={(e) => set(k, e.target.value as never)} />
    </label>
  )

  return (
    <>
      {confirmed && (
        <div className="zkp-info">
          Zakres potwierdził {card?.range_confirmed_by_name || '—'} · {fmt(card?.range_confirmed_at)}. Część A/B zablokowana.
          {canConfirm && !card?.decision && (
            <button type="button" className="zkp-link" onClick={() => void reopen()}>Cofnij potwierdzenie (z powodem)…</button>
          )}
        </div>
      )}
      {card?.range_reopen_reason && !confirmed && <p className="zkp-hint">Poprzednio cofnięto potwierdzenie: {card.range_reopen_reason}</p>}

      <h3 className="zkp-trace-h">A. Identyfikacja konstrukcji</h3>
      <div className="zkp-card-a">
        <span>Typ</span>{radio('product_type', Object.entries(ZKP_PRODUCT_TYPE_LABELS) as Array<[ZkpCardForm['product_type'], string]>)}
        <span>Skrzydła</span>{radio('leaves', [['1', '1-skrzydłowe'], ['2', '2-skrzydłowe']])}
        <span>Kierunek</span>{radio('opening', Object.entries(ZKP_OPENING_LABELS) as Array<[ZkpCardForm['opening'], string]>)}
        <span>Strona</span>{radio('hand', [['L', 'L'], ['P', 'P']])}
        <span>Zakres raportu</span>
        <span className="zkp-decision-pick">
          {api.ranges.map((r) => (
            <label key={r.code} title={`${r.label} — ${r.report}`}>
              <input type="radio" disabled={!editable} checked={f.range_code === r.code} onChange={() => set('range_code', r.code)} /> {r.code}
              <small className="zkp-hint" style={{ margin: 0 }}> ({r.report})</small>
            </label>
          ))}
        </span>
        <span>Ewakuacja</span>{radio('evacuation', Object.entries(ZKP_EVACUATION_LABELS) as Array<[ZkpCardForm['evacuation'], string]>)}
        <span>Nad- / doświetle</span>{radio('light', Object.entries(ZKP_LIGHT_LABELS) as Array<[ZkpCardForm['light'], string]>)}
      </div>
      {!lightAllowed && <p className="zkp-problems">Zakres {f.range_code} nie dopuszcza {ZKP_LIGHT_LABELS[f.light]} (tylko EI30 i EI60).</p>}
      <p className="zkp-hint">
        Kod typu wyrobu (zał. 6.8): <code className="zkp-type-code">{zkpTypeCode(f) || '— uzupełnij typ, zakres i skrzydła —'}</code>
      </p>

      <h3 className="zkp-trace-h">B. Sprawdzenie zakresu — wymiary skrzydeł i okuć</h3>
      <div className="order-form-grid zkp-form-grid">
        {num('active_w', 'Skrzydło czynne — szer.')}
        {num('active_h', 'Skrzydło czynne — wys.')}
        {num('passive_w', 'Skrzydło bierne — szer.', 'mm', f.leaves !== '2')}
        {num('passive_h', 'Skrzydło bierne — wys.', 'mm', f.leaves !== '2')}
        {num('light_w', 'Nad-/doświetle — szer.', 'mm', f.light === 'brak')}
        {num('light_h', 'Nad-/doświetle — wys.', 'mm', f.light === 'brak')}
        {num('leaf_mass_kg', 'Masa skrzydła (obliczona)', 'kg')}
        {num('fill_thickness_mm', 'Grubość wypełnienia G')}
        {num('hinges_count', 'Zawiasy na skrzydło', 'szt.')}
        {num('pins_count', 'Trzpienie antywyważeniowe', 'szt.')}
        <label>
          <span className="order-field-label-text">Wypełnienie — tabela / wiersz raportu</span>
          <input disabled={!editable} value={f.fill_ref} onChange={(e) => set('fill_ref', e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Profile i wkłady — wiersze tabel (cz. B)</span>
          <input disabled={!editable} value={f.profiles_ref} onChange={(e) => set('profiles_ref', e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Rozwiązanie progowe (cz. C)</span>
          <input disabled={!editable} value={f.threshold_ref} onChange={(e) => set('threshold_ref', e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Konstrukcja mocująca: rodzaj, grubość, gęstość (cz. G)</span>
          <input disabled={!editable} value={f.mounting_ref} onChange={(e) => set('mounting_ref', e.target.value)} />
        </label>
      </div>
      <div className="zkp-checks">
        {([
          ['profiles_ok', 'Profile i wkłady zgodne z tabelami raportu (6.10.5 B)'],
          ['threshold_ok', 'Rozwiązanie progowe dopuszczone (6.10.5 C)'],
          ['hardware_ok', 'Okucia z listy dla zakresu (6.10.5 F)'],
          ['mounting_ok', 'Konstrukcja mocująca dopuszczona (6.10.5 G)'],
        ] as Array<[keyof ZkpCardForm, string]>).map(([k, label]) => (
          <label key={k}>
            <input type="checkbox" disabled={!editable} checked={Boolean(f[k])} onChange={(e) => set(k, e.target.checked as never)} /> {label}
          </label>
        ))}
      </div>
      {editable && (
        <div>
          <button type="button" className="btn btn-primary" disabled={api.saving} onClick={() => void save()}>
            {api.saving ? 'Zapisuję…' : card ? 'Zapisz i sprawdź zakres' : 'Załóż kartę i sprawdź zakres'}
          </button>
        </div>
      )}

      {checks.length > 0 && (
        <table className="zkp-history" style={{ marginTop: 8 }}>
          <thead>
            <tr><th>Parametr</th><th>Wartość w zleceniu</th><th>Limit (tabela K / 6.10.5)</th><th>Zgodne</th></tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.r_key} className={c.r_ok ? undefined : 'zkp-row--nok'}>
                <td>{c.r_label}</td>
                <td>{c.r_value ?? '—'}</td>
                <td>{c.r_limit}</td>
                <td>{c.r_ok ? '✔' : <span className="zkp-warn">✘</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {card && !confirmed && canConfirm && (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-primary" disabled={api.saving || !allOk} onClick={() => void confirm()}>
            ✔ Potwierdź zakres (PJ / Kierownik Produkcji)
          </button>
          {!allOk && <span className="zkp-hint" style={{ marginLeft: 8 }}>Wszystkie wiersze muszą być zgodne — popraw i zapisz.</span>}
        </div>
      )}
      {card && !confirmed && !canConfirm && <p className="zkp-hint">Zakres potwierdza Pełnomocnik ZKP, Zastępca albo Kierownik Produkcji.</p>}
      {!canFill && !confirmed && (
        <p className="zkp-hint">Kartę zakłada i zakres potwierdza PJ / Kierownik Produkcji — potem w części C wpisuje się etapy z partiami.</p>
      )}
    </>
  )
}

// ── C. Etapy ────────────────────────────────────────────────────────────
function emptyGaps(): ZkpGaps {
  return { A: { zaw: null, zamk: null, nad: null }, B: { zaw: null, zamk: null, nad: null }, C: { zaw: null, zamk: null, nad: null } }
}

function SectionC({ api, zkp, canFill, save }: {
  api: ZkpCardApi; zkp: ZkpData; canFill: boolean
  save: ZkpCardApi['recordStage']
}) {
  const stages = api.data?.stages ?? []
  const current = latestBy(stages, (s) => s.stage_key)
  const [editing, setEditing] = useState<ZkpStageDef | null>(null)
  const lotById = new Map(zkp.lots.map((l) => [l.id, l]))

  return (
    <>
      <p className="zkp-hint">
        Etapy K (krytyczne) z komponentem wymagają partii przyjętej w rejestrze 6.24, z nr katalogowym z listy 6.10.5 dla zakresu
        karty. Każdy zapis zostaje w historii — poprawka = nowy wpis.
      </p>
      <table className="zkp-history">
        <thead>
          <tr><th>Etap</th><th>Komponent / nr kat.</th><th>Nr partii</th><th>Wynik</th><th>Data</th><th>Operator</th><th /></tr>
        </thead>
        <tbody>
          {ZKP_STAGES.map((s) => {
            const r = current.get(s.key)
            const lot = r?.lot_id != null ? lotById.get(r.lot_id) : undefined
            const history = stages.filter((x) => x.stage_key === s.key).length
            return (
              <tr key={s.key} className={r?.result === 'NOK' ? 'zkp-row--nok' : undefined}>
                <td>{s.no}. {s.label}{s.critical ? ' K' : ''}</td>
                <td>
                  {r?.catalog_no || '—'}
                  {r?.stage_key === 'regulacja' && r.gaps && (
                    <div className="zkp-hint" style={{ margin: 0 }}>
                      {(['A', 'B', 'C'] as const).map((g) => `${g}: ${ZKP_GAP_SIDES.map((sd) => r.gaps?.[g][sd.key] ?? '—').join('/')}`).join(' · ')}
                    </div>
                  )}
                </td>
                <td>{lot ? lot.lot_no : s.lotKind ? '—' : '–'}</td>
                <td>{r ? <b className={r.result === 'NOK' ? 'zkp-warn' : undefined}>{r.result === 'nd' ? 'n/d' : r.result}</b> : <span className="zkp-missing">brak</span>}</td>
                <td>{r ? fmt(r.recorded_at) : ''}</td>
                <td title={r?.recorded_by_name ? `konto: ${r.recorded_by_name}` : undefined}>{r?.operator ?? ''}</td>
                <td>
                  {canFill && <button type="button" className="zkp-link" onClick={() => setEditing(s)}>{r ? 'popraw' : 'wpisz'}</button>}
                  {history > 1 && <span className="zkp-hint" style={{ margin: '0 0 0 6px' }}>({history} wpisy)</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {editing && (
        <StageEditor
          def={editing}
          api={api}
          zkp={zkp}
          onCancel={() => setEditing(null)}
          onSave={async (cat, lot, res, gaps, notes, op) => {
            if (await save(editing.key, cat, lot, res, gaps, notes, op)) setEditing(null)
          }}
        />
      )}
    </>
  )
}

function StageEditor({ def, api, zkp, onCancel, onSave }: {
  def: ZkpStageDef; api: ZkpCardApi; zkp: ZkpData
  onCancel: () => void
  onSave: (catalog: string, lotId: number | null, result: ZkpStageResult, gaps: ZkpGaps | null, notes: string, operator: string) => Promise<void>
}) {
  const range = api.ranges.find((r) => r.code === api.data?.card?.range_code)
  const lots = useMemo(
    () => (def.lotKind ? lotsForStage(zkp.lots, zkp.components, def.lotKind, api.allowedCodes) : []),
    [def.lotKind, zkp.lots, zkp.components, api.allowedCodes],
  )
  const [lotId, setLotId] = useState('')
  const [catalog, setCatalog] = useState('')
  const [result, setResult] = useState<ZkpStageResult>('OK')
  const [gaps, setGaps] = useState<ZkpGaps>(emptyGaps)
  const [notes, setNotes] = useState('')
  const [operator, setOperator] = useState('')
  // zał. 6.27: etap podpisuje tylko osoba z aktywnym uprawnieniem do operacji — baza sprawdza to samo
  const signers = useMemo(() => peopleWithCompetency(zkp.people, zkp.competencies, def.operation), [zkp.people, zkp.competencies, def.operation])
  const pickLot = (id: string) => {
    setLotId(id)
    const l = lots.find((x) => String(x.id) === id)
    if (l) setCatalog(l.catalog_no)
  }
  const overLimit = def.key === 'regulacja' && range
    ? (['A', 'B', 'C'] as const).flatMap((g) => ZKP_GAP_SIDES.filter((s) => (gaps[g][s.key] ?? 0) > range.gaps[g][s.key]).map((s) => `${g} ${s.label}`))
    : []
  const problems = [
    signers.length === 0 && `Nikt nie ma uprawnienia do ${def.operation} w matrycy kompetencji (6.27) — nadaje Pełnomocnik ZKP.`,
    signers.length > 0 && !operator && 'Wybierz operatora.',
    def.lotKind && result === 'OK' && !lotId && 'Wybierz partię.',
    def.key === 'regulacja' && result === 'OK' && (['A', 'B', 'C'] as const).some((g) => ZKP_GAP_SIDES.some((s) => gaps[g][s.key] == null)) && 'Wpisz wszystkie szczeliny.',
    overLimit.length > 0 && result === 'OK' && `Szczeliny ponad limit: ${overLimit.join(', ')} — wynik NOK.`,
  ].filter(Boolean) as string[]

  return (
    <div className="zkp-stage-editor">
      <b>{def.no}. {def.label}</b>
      <div className="order-form-grid zkp-form-grid">
        {def.lotKind && (
          <label style={{ gridColumn: 'span 2' }}>
            <span className="order-field-label-text">Partia (przyjęta, z listy 6.10.5 dla {range?.code ?? 'zakresu'}) *</span>
            <select value={lotId} onChange={(e) => pickLot(e.target.value)}>
              <option value="">— wybierz partię —</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.catalog_no} · partia {l.lot_no} · {l.received_on} · {l.delivery_doc}
                </option>
              ))}
            </select>
            {lots.length === 0 && <small className="zkp-problems">Brak przyjętych partii tego rodzaju z listy dla zakresu — najpierw przyjęcie (6.24).</small>}
          </label>
        )}
        <label>
          <span className="order-field-label-text">Nr katalogowy / komponent</span>
          <input value={catalog} onChange={(e) => setCatalog(e.target.value)} placeholder={def.key === 'ciecie' ? 'profile: P2423XX…' : ''} />
        </label>
        <label>
          <span className="order-field-label-text">Operator (uprawniony do {def.operation}, zał. 6.27) *</span>
          <select value={operator} onChange={(e) => setOperator(e.target.value)}>
            <option value="">— wybierz osobę —</option>
            {signers.map((p) => (
              <option key={p.id} value={p.initials}>{p.initials} · {p.full_name || p.initials}</option>
            ))}
          </select>
        </label>
        <label style={{ gridColumn: 'span 2' }}>
          <span className="order-field-label-text">Uwagi</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {def.key === 'regulacja' && (
        <table className="zkp-history" style={{ maxWidth: 560 }}>
          <thead>
            <tr><th>Szczelina [mm]</th>{ZKP_GAP_SIDES.map((s) => <th key={s.key}>{s.label}</th>)}</tr>
          </thead>
          <tbody>
            {(['A', 'B', 'C'] as const).map((g) => (
              <tr key={g}>
                <td>{g}</td>
                {ZKP_GAP_SIDES.map((s) => {
                  const v = gaps[g][s.key]
                  const lim = range?.gaps[g][s.key]
                  return (
                    <td key={s.key}>
                      <input
                        inputMode="decimal"
                        style={{ width: 70 }}
                        className={v != null && lim != null && v > lim ? 'zkp-input--nok' : undefined}
                        value={v ?? ''}
                        onChange={(e) => {
                          const t = e.target.value.replace(',', '.').trim()
                          const n = t === '' ? null : Number(t)
                          setGaps((p) => ({ ...p, [g]: { ...p[g], [s.key]: n != null && Number.isFinite(n) ? n : null } }))
                        }}
                      />
                      <small className="zkp-hint" style={{ margin: '0 0 0 4px' }}>≤ {lim ?? '?'}</small>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="zkp-decision-pick">
        <label><input type="radio" checked={result === 'OK'} onChange={() => setResult('OK')} /> OK</label>
        <label><input type="radio" checked={result === 'NOK'} onChange={() => setResult('NOK')} /> NOK</label>
        {def.allowNa && <label><input type="radio" checked={result === 'nd'} onChange={() => setResult('nd')} /> n/d</label>}
      </div>
      {problems.length > 0 && <div className="zkp-problems">{problems.join(' ')}</div>}
      <div className="zkp-actions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={api.saving || problems.length > 0}
          onClick={() => void onSave(catalog, lotId ? Number(lotId) : null, result, def.key === 'regulacja' ? gaps : null, notes, operator)}
        >
          Zapisz etap
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel}>Anuluj</button>
      </div>
    </div>
  )
}

// ── D. Okucia ───────────────────────────────────────────────────────────
function SectionD({ api, zkp, canFill, save }: { api: ZkpCardApi; zkp: ZkpData; canFill: boolean; save: ZkpCardApi['saveHardware'] }) {
  const current = latestBy(api.data?.hardware ?? [], (h) => h.slot)
  const [editing, setEditing] = useState<ZkpHardwareSlot | null>(null)
  const lots = useMemo(() => lotsForStage(zkp.lots, zkp.components, 'okucie', null), [zkp.lots, zkp.components])
  const hardwareModels = useMemo(() => zkp.components.filter((c) => c.zkp_critical_kind === 'okucie'), [zkp.components])
  const lotById = new Map(zkp.lots.map((l) => [l.id, l]))
  const [f, setF] = useState({ producer_model: '', dwu_no: '', count: '', condition_ref: '', lot_id: '' })

  const start = (slot: ZkpHardwareSlot) => {
    const r = current.get(slot)
    setF({ producer_model: r?.producer_model ?? '', dwu_no: r?.dwu_no ?? '', count: r ? String(r.count) : '', condition_ref: r?.condition_ref ?? '', lot_id: r?.lot_id ? String(r.lot_id) : '' })
    setEditing(slot)
  }
  const pickModel = (name: string) => {
    const c = hardwareModels.find((x) => `${x.name}${x.zkp_model ? ` (${x.zkp_model})` : ''}` === name)
    setF((p) => ({ ...p, producer_model: name, dwu_no: p.dwu_no || c?.zkp_dwu_number || '' }))
  }

  return (
    <>
      <table className="zkp-history">
        <thead>
          <tr><th>Okucie</th><th>Producent / model</th><th>Nr DWU / dokumentu</th><th>Liczba</th><th>Punkt raportu / warunek</th><th>Partia</th><th /></tr>
        </thead>
        <tbody>
          {ZKP_HARDWARE_SLOTS.map((s) => {
            const r = current.get(s.key)
            return (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td>{r?.producer_model || '—'}</td>
                <td>{r?.dwu_no || ''}</td>
                <td>{r ? r.count : ''}</td>
                <td>{r?.condition_ref || ''}</td>
                <td>{r?.lot_id ? lotById.get(r.lot_id)?.lot_no ?? `#${r.lot_id}` : ''}</td>
                <td>{canFill && <button type="button" className="zkp-link" onClick={() => start(s.key)}>{r ? 'popraw' : 'wpisz'}</button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {editing && (
        <div className="zkp-stage-editor">
          <b>{ZKP_HARDWARE_SLOTS.find((s) => s.key === editing)?.label}</b>
          <div className="order-form-grid zkp-form-grid">
            <label>
              <span className="order-field-label-text">Producent / model</span>
              <input list="zkp-hw-models" value={f.producer_model} onChange={(e) => pickModel(e.target.value)} />
              <datalist id="zkp-hw-models">
                {hardwareModels.map((c) => <option key={c.id} value={`${c.name}${c.zkp_model ? ` (${c.zkp_model})` : ''}`} />)}
              </datalist>
            </label>
            <label>
              <span className="order-field-label-text">Nr DWU / dokumentu</span>
              <input value={f.dwu_no} onChange={(e) => setF((p) => ({ ...p, dwu_no: e.target.value }))} />
            </label>
            <label>
              <span className="order-field-label-text">Liczba</span>
              <input inputMode="numeric" value={f.count} onChange={(e) => setF((p) => ({ ...p, count: e.target.value }))} />
            </label>
            <label>
              <span className="order-field-label-text">Punkt raportu / warunek</span>
              <input value={f.condition_ref} onChange={(e) => setF((p) => ({ ...p, condition_ref: e.target.value }))} />
            </label>
            <label>
              <span className="order-field-label-text">Partia (opcjonalnie)</span>
              <select value={f.lot_id} onChange={(e) => setF((p) => ({ ...p, lot_id: e.target.value }))}>
                <option value="">—</option>
                {lots.map((l) => <option key={l.id} value={l.id}>{l.catalog_no} · {l.lot_no}</option>)}
              </select>
            </label>
          </div>
          <div className="zkp-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={api.saving || !f.producer_model.trim()}
              onClick={async () => {
                if (await save(editing, f.producer_model, f.dwu_no, Number(f.count) || 0, f.condition_ref, f.lot_id ? Number(f.lot_id) : null)) setEditing(null)
              }}
            >
              Zapisz okucie
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setEditing(null)}>Anuluj</button>
          </div>
        </div>
      )}
    </>
  )
}

// ── E. Wypełnienia ──────────────────────────────────────────────────────
function SectionE({ api, zkp, canFill, save }: { api: ZkpCardApi; zkp: ZkpData; canFill: boolean; save: ZkpCardApi['saveFilling'] }) {
  const card = api.data?.card
  const current = latestBy(api.data?.fillings ?? [], (x) => x.field)
  const required = card ? requiredFillingFields(card) : []
  const [editing, setEditing] = useState<ZkpFillingField | null>(null)
  const lots = useMemo(() => lotsForStage(zkp.lots, zkp.components, ['szklo', 'wypelnienie'], null), [zkp.lots, zkp.components])
  const lotById = new Map(zkp.lots.map((l) => [l.id, l]))
  const range = api.ranges.find((r) => r.code === card?.range_code)
  const [f, setF] = useState({ table_row: '', product: '', thickness: '', dims: '', lot_id: '' })
  const start = (field: ZkpFillingField) => {
    const r = current.get(field)
    setF({ table_row: r?.table_row ?? card?.fill_ref ?? '', product: r?.product ?? '', thickness: r?.thickness_mm != null ? String(r.thickness_mm) : card?.fill_thickness_mm != null ? String(card.fill_thickness_mm) : '', dims: r?.dims ?? '', lot_id: r?.lot_id ? String(r.lot_id) : '' })
    setEditing(field)
  }
  const thick = Number(f.thickness.replace(',', '.'))
  const thickBad = f.thickness.trim() !== '' && range && (thick < range.fill_min || thick > range.fill_max)

  return (
    <>
      <table className="zkp-history">
        <thead>
          <tr><th>Pole</th><th>Tabela / wiersz raportu</th><th>Producent / nazwa / budowa</th><th>Grubość [mm]</th><th>Wymiary [mm]</th><th>Nr partii</th><th /></tr>
        </thead>
        <tbody>
          {ZKP_FILLING_FIELDS.map((fl) => {
            const r = current.get(fl.key)
            const needed = required.includes(fl.key)
            return (
              <tr key={fl.key} style={needed ? undefined : { opacity: 0.55 }}>
                <td>{fl.label}{needed ? ' *' : ''}</td>
                <td>{r?.table_row ?? ''}</td>
                <td>{r?.product ?? (needed ? <span className="zkp-missing">brak</span> : '')}</td>
                <td>{r?.thickness_mm ?? ''}</td>
                <td>{r?.dims ?? ''}</td>
                <td>{r?.lot_id ? lotById.get(r.lot_id)?.lot_no ?? `#${r.lot_id}` : ''}</td>
                <td>{canFill && <button type="button" className="zkp-link" onClick={() => start(fl.key)}>{r ? 'popraw' : 'wpisz'}</button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {editing && (
        <div className="zkp-stage-editor">
          <b>{ZKP_FILLING_FIELDS.find((x) => x.key === editing)?.label}</b>
          <div className="order-form-grid zkp-form-grid">
            <label>
              <span className="order-field-label-text">Tabela / wiersz raportu</span>
              <input value={f.table_row} onChange={(e) => setF((p) => ({ ...p, table_row: e.target.value }))} />
            </label>
            <label>
              <span className="order-field-label-text">Producent / nazwa handlowa / budowa</span>
              <input value={f.product} onChange={(e) => setF((p) => ({ ...p, product: e.target.value }))} />
            </label>
            <label>
              <span className="order-field-label-text">Grubość [mm] {range ? `(${range.fill_min}–${range.fill_max})` : ''}</span>
              <input inputMode="decimal" className={thickBad ? 'zkp-input--nok' : undefined} value={f.thickness} onChange={(e) => setF((p) => ({ ...p, thickness: e.target.value }))} />
            </label>
            <label>
              <span className="order-field-label-text">Wymiary [mm]</span>
              <input value={f.dims} onChange={(e) => setF((p) => ({ ...p, dims: e.target.value }))} placeholder="np. 640×1820" />
            </label>
            <label>
              <span className="order-field-label-text">Partia szkła / wypełnienia</span>
              <select value={f.lot_id} onChange={(e) => setF((p) => ({ ...p, lot_id: e.target.value }))}>
                <option value="">—</option>
                {lots.map((l) => <option key={l.id} value={l.id}>{l.catalog_no} · {l.lot_no} · {l.delivery_doc}</option>)}
              </select>
            </label>
          </div>
          {thickBad && <div className="zkp-problems">Grubość poza zakresem {range?.code}.</div>}
          <div className="zkp-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={api.saving || !f.product.trim() || !!thickBad}
              onClick={async () => {
                const t = f.thickness.trim() === '' ? null : thick
                if (await save(editing, f.table_row, f.product, t, f.dims, f.lot_id ? Number(f.lot_id) : null)) setEditing(null)
              }}
            >
              Zapisz wypełnienie
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setEditing(null)}>Anuluj</button>
          </div>
        </div>
      )}
    </>
  )
}

// ── F. Zwolnienie ───────────────────────────────────────────────────────
function SectionF({ api, target, canDecide, save, onGoProtocol }: {
  api: ZkpCardApi; target: ZkpCardTarget; canDecide: boolean; save: ZkpCardApi['decide']; onGoProtocol: () => void
}) {
  const card = api.data?.card
  const problems = api.data?.problems ?? []
  const released = (api.data?.protocols ?? []).find((p) => p.decision === 'zwolniony') ?? null
  const [f, setF] = useState({ protocol: '', declaration: '', released_on: '', nc: '', notes: '' })
  if (!card) return null
  const range = api.ranges.find((r) => r.code === card.range_code) ?? null

  if (card.decision) {
    return (
      <div className="alu-details-grid">
        <div><span className="alu-details-label">Decyzja</span><b>{card.decision === 'zwolniony' ? 'ZWOLNIONY' : 'NIEZGODNY'}</b></div>
        <div>
          <span className="alu-details-label">Protokół badań 6.17.5 nr</span>{card.test_protocol_no || '—'}
          {released && (
            <button type="button" className="zkp-link" style={{ marginLeft: 6 }} onClick={() => printProtocolPdf({ protocol: released, card, range, constructionNo: target.constructionNo, orderNumber: target.orderNumber, company: target.company })}>
              🖨 PDF
            </button>
          )}
        </div>
        <div><span className="alu-details-label">Deklaracja (KDWU / DWU)</span>{card.declaration_no || '—'}</div>
        <div><span className="alu-details-label">Data wydania</span>{card.released_on || '—'}</div>
        {card.nonconformity_ref && <div><span className="alu-details-label">Rejestr 6.20 nr</span>{card.nonconformity_ref}</div>}
        <div><span className="alu-details-label">Pełnomocnik / Zastępca</span>{card.decided_by_name} · {fmt(card.decided_at)}</div>
        {card.decision_notes && <div style={{ gridColumn: '1 / -1' }}><span className="alu-details-label">Uwagi</span>{card.decision_notes}</div>}
      </div>
    )
  }

  // zwolnienie idzie przez protokół 6.17.5 (cz. G) — tu zostaje tylko odrzucenie bez protokołu (np. złom)
  const decide = async () => {
    const ok = await appConfirm(
      `Oznaczyć konstrukcję jako NIEZGODNĄ (rejestr 6.20 nr ${f.nc})? Karta zostanie zamknięta bez zwolnienia.`,
      { title: 'Zwolnienie — zał. 6.25 cz. F', confirmLabel: 'Niezgodna' },
    )
    if (ok) await save('niezgodny', f.protocol, f.declaration, f.released_on || null, f.nc, f.notes)
  }

  return (
    <>
      {problems.length > 0 ? (
        <div className="zkp-warnbox">
          <b>Do zwolnienia brakuje:</b>
          <ul style={{ margin: '4px 0 0 18px' }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ) : (
        <div className="zkp-info">
          Karta kompletna. Zwolnienie (ZWOLNIONY) następuje przez <b>protokół badań 6.17.5</b> — część G:{' '}
          <button type="button" className="zkp-link" onClick={onGoProtocol}>przejdź do protokołu →</button>
        </div>
      )}
      <p className="zkp-hint">Numer deklaracji KDWU / DWU nadaje zakładka „Deklaracje (6.9)” po zwolnieniu i wraca tu sam.</p>
      <div className="order-form-grid zkp-form-grid">
        <label>
          <span className="order-field-label-text">Niezgodność — rejestr 6.20 nr</span>
          <input disabled={!canDecide} value={f.nc} onChange={(e) => setF((p) => ({ ...p, nc: e.target.value }))} />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span className="order-field-label-text">Uwagi</span>
          <input disabled={!canDecide} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
        </label>
      </div>
      {canDecide ? (
        <div className="zkp-actions">
          <button type="button" className="btn btn-danger" disabled={api.saving || !f.nc.trim()} onClick={() => void decide()} title="Zamknięcie karty bez zwolnienia (np. konstrukcja do złomowania) — z wpisem w rejestrze 6.20">
            NIEZGODNY — zamknij bez zwolnienia
          </button>
        </div>
      ) : (
        <p className="zkp-hint">Zwalnia Pełnomocnik ZKP albo Zastępca (rola ZKP na koncie).</p>
      )}
    </>
  )
}
