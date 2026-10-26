import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { ZKP_CRITICAL_KIND_LABELS, ZKP_LOT_DECISION_LABELS } from '../../lib/zkp'
import {
  ZKP_FILLING_FIELDS,
  ZKP_HARDWARE_SLOTS,
  ZKP_STAGES,
  latestBy,
  type ZkpFillingRecord,
  type ZkpHardwareRecord,
  type ZkpStageRecord,
} from '../../lib/zkpCard'
import type { ZkpData } from './ZkpView'

// Ścieżka z inspekcji: tabliczka → karta 6.25 → partia → rejestr przyjęć 6.24 → WZ / dokument jakości.
// Bieżące wpisy karty (etapy, okucia, wypełnienia) z partią.

type Used = { where: string; lotId: number }

export default function ZkpTraceLots({ constructionId, zkp }: { constructionId: number; zkp: ZkpData }) {
  const [used, setUsed] = useState<Used[] | null>(null)
  const [hasCard, setHasCard] = useState(false)

  useEffect(() => {
    let alive = true
    setUsed(null)
    void (async () => {
      const { data: card } = await supabase.from('zkp_product_cards').select('id').eq('construction_id', constructionId).maybeSingle<{ id: number }>()
      if (!alive) return
      if (!card) {
        setHasCard(false)
        setUsed([])
        return
      }
      setHasCard(true)
      const [st, hw, fl] = await Promise.all([
        supabase.from('zkp_card_stage_records').select('*').eq('card_id', card.id),
        supabase.from('zkp_card_hardware').select('*').eq('card_id', card.id),
        supabase.from('zkp_card_fillings').select('*').eq('card_id', card.id),
      ])
      if (!alive) return
      const out: Used[] = []
      for (const [k, r] of latestBy((st.data ?? []) as ZkpStageRecord[], (x) => x.stage_key)) {
        if (r.lot_id != null) out.push({ where: `Etap ${ZKP_STAGES.find((s) => s.key === k)?.no ?? ''} ${ZKP_STAGES.find((s) => s.key === k)?.label ?? k}`, lotId: r.lot_id })
      }
      for (const [k, r] of latestBy((hw.data ?? []) as ZkpHardwareRecord[], (x) => x.slot)) {
        if (r.lot_id != null) out.push({ where: `Okucie: ${ZKP_HARDWARE_SLOTS.find((s) => s.key === k)?.label ?? k}`, lotId: r.lot_id })
      }
      for (const [k, r] of latestBy((fl.data ?? []) as ZkpFillingRecord[], (x) => x.field)) {
        if (r.lot_id != null) out.push({ where: `Wypełnienie: ${ZKP_FILLING_FIELDS.find((s) => s.key === k)?.label ?? k}`, lotId: r.lot_id })
      }
      setUsed(out)
    })()
    return () => {
      alive = false
    }
  }, [constructionId])

  if (used === null) return <p className="zkp-hint">Wczytuję partie…</p>
  if (!hasCard) return <p className="zkp-hint">Konstrukcja nie ma jeszcze karty wyrobu — partie pojawią się po wpisaniu etapów.</p>
  if (used.length === 0) return <p className="zkp-hint">Karta bez wpisanych partii.</p>

  const lotById = new Map(zkp.lots.map((l) => [l.id, l]))
  const compById = new Map(zkp.components.map((c) => [c.id, c]))
  const supById = new Map(zkp.suppliers.map((s) => [s.id, s.name]))

  return (
    <table className="zkp-history">
      <thead>
        <tr><th>Gdzie w konstrukcji</th><th>Komponent</th><th>Nr kat.</th><th>Partia</th><th>Przyjęcie 6.24 (dostawca, WZ / faktura)</th><th>Dokument jakości</th><th>Decyzja</th></tr>
      </thead>
      <tbody>
        {used.map((u) => {
          const l = lotById.get(u.lotId)
          const c = l ? compById.get(l.component_id) : undefined
          return (
            <tr key={`${u.where}-${u.lotId}`}>
              <td>{u.where}</td>
              <td>{c ? `${c.name}${c.zkp_critical_kind ? ` · ${ZKP_CRITICAL_KIND_LABELS[c.zkp_critical_kind]}` : ''}` : '—'}</td>
              <td>{l?.catalog_no ?? ''}</td>
              <td><b>{l?.lot_no ?? `#${u.lotId}`}</b></td>
              <td>{l ? `${l.received_on} · ${supById.get(l.supplier_id) ?? '—'} · ${l.delivery_doc}` : ''}</td>
              <td>
                {l ? [l.quality_doc_kind, l.quality_doc_no].filter(Boolean).join(' ') : ''}
                {l?.quality_doc_path && (
                  <button type="button" className="zkp-link" style={{ marginLeft: 6 }} onClick={() => void zkp.openScan(l.quality_doc_path!)}>
                    📎 skan
                  </button>
                )}
              </td>
              <td>{l ? ZKP_LOT_DECISION_LABELS[l.decision] : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
