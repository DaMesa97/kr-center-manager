// Partie ościeżnic regulowanych / opaskowych (Bastion) — odpowiednik arkusza
// „OŚC.REG. NOWE". Etapy paneli i opasek są WSPÓLNE dla partii; skręcanie
// zostaje na zleceniu (etap oscieznica_skrecanie) i zamyka partię, gdy
// wszystkie zlecenia są skręcone. Zapis wyłącznie przez RPC bastion_batch_*.

export type BastionBatchStageDef = { key: string; header: string; title: string; group: 'panele' | 'opaski' }

/** Kolejność = kolejność kolumn w arkuszu NOWE. Klucze pilnowane też w bazie (bastion_batch_stage_keys). */
export const BASTION_BATCH_STAGE_DEFS: BastionBatchStageDef[] = [
  { key: 'panele_ciecie', header: 'CIĘCIE', title: 'Panele — cięcie', group: 'panele' },
  { key: 'panele_frezarki', header: 'FREZ.', title: 'Panele — frezarki', group: 'panele' },
  { key: 'panele_cnc', header: 'CNC', title: 'Panele — CNC', group: 'panele' },
  { key: 'panele_lakiernia', header: 'LAKIER.', title: 'Panele — lakiernia', group: 'panele' },
  { key: 'panele_oklejarki', header: 'OKLEJ.', title: 'Panele — oklejarki', group: 'panele' },
  { key: 'opaski_ciecie', header: 'CIĘCIE', title: 'Opaski — cięcie', group: 'opaski' },
  { key: 'opaski_cnc', header: 'CNC', title: 'Opaski — CNC', group: 'opaski' },
]

export type BastionBatchStage = { v: string; at: string | null; by: string | null }

export type BastionBatch = {
  id: number
  batch_no: number
  status: 'open' | 'closed'
  notes: string | null
  stages: Record<string, BastionBatchStage>
  created_at: string
  created_by: string | null
  updated_at: string
  closed_at: string | null
  items_count: number
  screwed_count: number
  screwed_from: string | null
  screwed_to: string | null
  order_ids: number[]
  order_numbers: string[]
  order_screwed: boolean[]
}

export function mapBastionBatchRow(r: Record<string, unknown>): BastionBatch {
  const stagesRaw = (r.stages && typeof r.stages === 'object' ? r.stages : {}) as Record<string, unknown>
  const stages: Record<string, BastionBatchStage> = {}
  for (const [k, val] of Object.entries(stagesRaw)) {
    if (val && typeof val === 'object') {
      const o = val as Record<string, unknown>
      stages[k] = { v: String(o.v ?? ''), at: (o.at as string | null) ?? null, by: (o.by as string | null) ?? null }
    } else if (typeof val === 'string') {
      stages[k] = { v: val, at: null, by: null }
    }
  }
  const nums = (x: unknown) => (Array.isArray(x) ? x.map((v) => Number(v)) : [])
  return {
    id: Number(r.id),
    batch_no: Number(r.batch_no),
    status: r.status === 'closed' ? 'closed' : 'open',
    notes: (r.notes as string | null) ?? null,
    stages,
    created_at: String(r.created_at ?? ''),
    created_by: (r.created_by as string | null) ?? null,
    updated_at: String(r.updated_at ?? ''),
    closed_at: (r.closed_at as string | null) ?? null,
    items_count: Number(r.items_count ?? 0),
    screwed_count: Number(r.screwed_count ?? 0),
    screwed_from: (r.screwed_from as string | null) ?? null,
    screwed_to: (r.screwed_to as string | null) ?? null,
    order_ids: nums(r.order_ids),
    order_numbers: Array.isArray(r.order_numbers) ? r.order_numbers.map((v) => String(v ?? '')) : [],
    order_screwed: Array.isArray(r.order_screwed) ? r.order_screwed.map((v) => Boolean(v)) : [],
  }
}

/** Zlecenie → numer partii (kolumna PARTIA w tabeli zleceń). */
export function batchNoByOrderId(batches: BastionBatch[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const b of batches) for (const id of b.order_ids) m.set(id, b.batch_no)
  return m
}

const fmtDay = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** „24.10–26.10" jak w arkuszu (SKRĘCANIE KPL), pusty gdy nic nie skręcono. */
export function screwingRangeLabel(b: Pick<BastionBatch, 'screwed_from' | 'screwed_to'>): string {
  const a = fmtDay(b.screwed_from)
  const z = fmtDay(b.screwed_to)
  if (!a) return ''
  return a === z || !z ? a : `${a}–${z}`
}

/** Postęp etapów partii: ile z 7 odhaczonych. */
export function batchStageProgress(b: BastionBatch): number {
  return BASTION_BATCH_STAGE_DEFS.filter((d) => (b.stages[d.key]?.v ?? '').trim() !== '').length
}
