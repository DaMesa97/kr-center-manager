// D55 (28.11): podgląd skutków „Nadpisz” nowej wersji LP (RPC alu_overwrite_impact).
// Baza zwraca wiersze: co zniknie / zostanie przycięte / anulowane, plus blokady (zwolniona karta wyrobu,
// wydana deklaracja na konstrukcji do anulowania). Tu tylko czyste funkcje do widoku (testowalne).

export type AluOverwriteImpactKind =
  | 'karta_zwolniona'
  | 'pozycja_usunieta'
  | 'konstrukcja_anulowana'
  | 'etapy_przyciete'
  | 'zmiana_systemu'

export type AluOverwriteImpactRow = {
  kind: string
  pos_no: number | null
  construction_no: string | null
  detail: string
  blocking: boolean
}

type RpcRow = {
  r_kind: string
  r_pos_no: number | null
  r_construction_no: string | null
  r_detail: string | null
  r_blocking: boolean | null
}

export const ALU_OVERWRITE_KIND_LABELS: Record<AluOverwriteImpactKind, string> = {
  karta_zwolniona: 'Zwolnione karty wyrobu (ZKP) — blokują nadpisanie',
  pozycja_usunieta: 'Pozycje, które znikną (numeru nie ma w nowej LP) — razem z oznaczonymi etapami',
  konstrukcja_anulowana: 'Konstrukcje, które zostaną anulowane',
  etapy_przyciete: 'Pozycje z mniejszą ilością — oznaczone etapy zostaną przycięte',
  zmiana_systemu: 'Zmiana systemu z / na AS 75EI (ZKP)',
}

const KIND_ORDER: AluOverwriteImpactKind[] = [
  'karta_zwolniona',
  'pozycja_usunieta',
  'konstrukcja_anulowana',
  'etapy_przyciete',
  'zmiana_systemu',
]

export function mapAluOverwriteImpactRows(data: unknown): AluOverwriteImpactRow[] {
  if (!Array.isArray(data)) return []
  return (data as RpcRow[]).map((r) => ({
    kind: String(r.r_kind ?? ''),
    pos_no: r.r_pos_no ?? null,
    construction_no: r.r_construction_no ?? null,
    detail: r.r_detail ?? '',
    blocking: r.r_blocking === true,
  }))
}

export type AluOverwriteImpactGroup = { kind: string; label: string; rows: AluOverwriteImpactRow[] }

/** Grupy do pokazania przed „Nadpisz” (kolejność jak w bazie: blokady, znikające pozycje, konstrukcje…). */
export function groupAluOverwriteImpact(rows: AluOverwriteImpactRow[]): AluOverwriteImpactGroup[] {
  const byKind = new Map<string, AluOverwriteImpactRow[]>()
  for (const r of rows) {
    const list = byKind.get(r.kind) ?? []
    list.push(r)
    byKind.set(r.kind, list)
  }
  const kinds = [...KIND_ORDER.filter((k) => byKind.has(k)), ...[...byKind.keys()].filter((k) => !KIND_ORDER.includes(k as AluOverwriteImpactKind))]
  return kinds.map((k) => ({
    kind: k,
    label: ALU_OVERWRITE_KIND_LABELS[k as AluOverwriteImpactKind] ?? k,
    rows: byKind.get(k) ?? [],
  }))
}

export const aluOverwriteIsBlocked = (rows: AluOverwriteImpactRow[]) => rows.some((r) => r.blocking)

/** Jedna linia wiersza: „Poz. 3 · 2026/12/04 — karta ZWOLNIONA …” */
export function formatAluOverwriteRow(r: AluOverwriteImpactRow): string {
  const head = [r.pos_no != null ? `Poz. ${r.pos_no}` : null, r.construction_no].filter(Boolean).join(' · ')
  return head ? `${head} — ${r.detail}` : r.detail
}
