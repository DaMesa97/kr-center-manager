// Bastion „Reszta": zamówienia na same progi / opaski / zabudowy itp.
// (arkusz Reszta). Własna numeracja od 363, cztery etapy jak w arkuszu.
// Zapis wyłącznie przez RPC bastion_extra_*.

export type BastionExtraStageDef = { key: string; header: string; title: string }

export const BASTION_EXTRA_STAGE_DEFS: BastionExtraStageDef[] = [
  { key: 'osc_cnc', header: 'OŚĆ CNC', title: 'Ościeżnica CNC (frezowanie)' },
  { key: 'osc_skrecanie', header: 'OŚĆ SKR.', title: 'Ościeżnica (skręcanie i okuwanie)' },
  { key: 'kontrola', header: 'MAG. KTR.', title: 'Magazyn, kontrola odbiorcza' },
  { key: 'stolarnia', header: 'STOL.', title: 'Stolarnia (zabudowy, progi, opaski itp.)' },
]

export type BastionExtraStage = { v: string; at: string | null; by: string | null }

export type BastionExtra = {
  id: number
  extra_no: number
  order_date: string
  company: string
  production_day: string
  description: string
  color: string
  width_side: string
  system: string
  quantity: number
  order_ref: string
  client_order_number: string
  rush: string
  notes: string
  sales_changes: string
  stages: Record<string, BastionExtraStage>
  label: string
  released_at: string | null
  is_cancelled: boolean
  entered_by: string
  created_at: string
  updated_at: string
}

/** Pola formularza (tworzenie / edycja) — to, co przyjmuje bastion_extra_create / _update. */
export type BastionExtraForm = {
  order_date: string
  company: string
  production_day: string
  description: string
  color: string
  width_side: string
  system: string
  quantity: number
  order_ref: string
  client_order_number: string
  rush: string
  notes: string
  sales_changes: string
}

export const emptyBastionExtraForm = (): BastionExtraForm => ({
  order_date: new Date().toISOString().slice(0, 10),
  company: '',
  production_day: '',
  description: '',
  color: '',
  width_side: '',
  system: '',
  quantity: 1,
  order_ref: '',
  client_order_number: '',
  rush: '',
  notes: '',
  sales_changes: '',
})

export const bastionExtraToForm = (e: BastionExtra): BastionExtraForm => ({
  order_date: e.order_date,
  company: e.company,
  production_day: e.production_day,
  description: e.description,
  color: e.color,
  width_side: e.width_side,
  system: e.system,
  quantity: e.quantity,
  order_ref: e.order_ref,
  client_order_number: e.client_order_number,
  rush: e.rush,
  notes: e.notes,
  sales_changes: e.sales_changes,
})

export function mapBastionExtraRow(r: Record<string, unknown>): BastionExtra {
  const stagesRaw = (r.stages && typeof r.stages === 'object' ? r.stages : {}) as Record<string, unknown>
  const stages: Record<string, BastionExtraStage> = {}
  for (const [k, val] of Object.entries(stagesRaw)) {
    if (val && typeof val === 'object') {
      const o = val as Record<string, unknown>
      stages[k] = { v: String(o.v ?? ''), at: (o.at as string | null) ?? null, by: (o.by as string | null) ?? null }
    }
  }
  const s = (k: string) => String(r[k] ?? '')
  return {
    id: Number(r.id),
    extra_no: Number(r.extra_no),
    order_date: s('order_date').slice(0, 10),
    company: s('company'),
    production_day: s('production_day'),
    description: s('description'),
    color: s('color'),
    width_side: s('width_side'),
    system: s('system'),
    quantity: Number(r.quantity ?? 1),
    order_ref: s('order_ref'),
    client_order_number: s('client_order_number'),
    rush: s('rush'),
    notes: s('notes'),
    sales_changes: s('sales_changes'),
    stages,
    label: s('label'),
    released_at: r.released_at ? s('released_at').slice(0, 10) : null,
    is_cancelled: Boolean(r.is_cancelled),
    entered_by: s('entered_by'),
    created_at: s('created_at'),
    updated_at: s('updated_at'),
  }
}

/** Ile dni od zamówienia bez realizacji — arkusz podświetlał 7 i 14 dni. */
export function bastionExtraAgeDays(e: Pick<BastionExtra, 'order_date' | 'released_at'>, today = new Date()): number | null {
  if (e.released_at) return null
  const d = new Date(e.order_date + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((today.getTime() - d.getTime()) / 86_400_000)
}
