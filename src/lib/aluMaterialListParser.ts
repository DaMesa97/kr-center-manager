import * as XLSX from 'xlsx'

// „Lista materiałowa" zlecenia aluminium z programu Aluron (.xls): materiały
// potrzebne do zlecenia OF — w teczce ZKP to „Zestawienie materiałowe" (ZKP 5.9),
// a przy przyjęciach podpowiada, co ma przyjechać do zlecenia.
//
// Układ arkusza: „Zlecenie: OF348/2026   Utworzono: 26.10.2026", wiersz nagłówków
// (Kod elementu | Nr GM | Opis | Ilość | Jednostka | Cena jedn. | Wartość |
// Potrzeba | Potrzeba(wartość) | Potrzeba(bez odpadów)), potem grupy (wiersz
// z samą nazwą), pozycje, „Razem:" grupy i „Razem wartość materiału bez rabatu".

export type AluMaterialItem = {
  group: string
  code: string
  gm_code: string
  description: string
  quantity: number
  /** np. „szt.", „opak.(25m)", „sztanga(6500mm)" */
  unit: string
  unit_price: number | null
  value: number | null
  need: number | null
  need_value: number | null
  /** zapotrzebowanie bez odpadów */
  need_net: number | null
}

export type AluMaterialListParseResult = {
  kind: 'LM'
  order_number: string
  /** YYYY-MM-DD z „Utworzono:" */
  created_at: string | null
  items: AluMaterialItem[]
  total_value: number | null
  total_need_value: number | null
  warnings: string[]
}

/** „1,625.35" / „1 625,35" / „4" → liczba; puste/śmieci → null */
export function parseListNumber(raw: string | undefined): number | null {
  let s = String(raw ?? '').replace(/\s/g, '')
  if (!s) return null
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '')
  else if (s.includes(',')) s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const cell = (r: string[], i: number) => String(r[i] ?? '').trim()
const round2 = (n: number) => Math.round(n * 100) / 100

export function parseAluMaterialListRows(rows: string[][]): AluMaterialListParseResult {
  const warnings: string[] = []
  let orderNumber = ''
  let createdAt: string | null = null
  let inTable = false
  let group = ''
  let groupSum = 0
  let totalValue: number | null = null
  let totalNeed: number | null = null
  const items: AluMaterialItem[] = []

  for (const r of rows) {
    const first = cell(r, 0)
    const nonEmpty = r.map((c) => String(c ?? '').trim()).filter(Boolean)
    if (nonEmpty.length === 0) continue

    if (!orderNumber && /Zlecenie:/i.test(first)) {
      orderNumber = first.match(/Zlecenie:\s*(\S+)/i)?.[1] ?? ''
      const d = first.match(/Utworzono:\s*(\d{2})\.(\d{2})\.(\d{4})/i)
      if (d) createdAt = `${d[3]}-${d[2]}-${d[1]}`
      continue
    }
    if (!inTable) {
      if (/^Kod elementu$/i.test(first)) inTable = true
      continue
    }

    // podsumowania (kolumna „Cena jedn." zawiera etykietę)
    const label = cell(r, 5)
    if (/^Razem wartość materiału/i.test(label)) {
      totalValue = parseListNumber(cell(r, 6))
      totalNeed = parseListNumber(cell(r, 8))
      break
    }
    if (/^Razem:$/i.test(label)) {
      const stated = parseListNumber(cell(r, 6))
      if (stated != null && Math.abs(round2(groupSum) - stated) > 0.02) {
        warnings.push(`Grupa „${group}": suma pozycji ${round2(groupSum)} ≠ „Razem" ${stated}`)
      }
      continue
    }

    // nazwa grupy = wiersz z jedną wartością w pierwszej kolumnie
    if (nonEmpty.length === 1 && first) {
      group = first
      groupSum = 0
      continue
    }

    if (!first) continue
    const quantity = parseListNumber(cell(r, 3))
    if (quantity == null) {
      warnings.push(`Pominięto wiersz bez ilości: ${first}`)
      continue
    }
    const value = parseListNumber(cell(r, 6))
    groupSum += value ?? 0
    items.push({
      group,
      code: first,
      gm_code: cell(r, 1),
      description: cell(r, 2),
      quantity,
      unit: cell(r, 4),
      unit_price: parseListNumber(cell(r, 5)),
      value,
      need: parseListNumber(cell(r, 7)),
      need_value: parseListNumber(cell(r, 8)),
      need_net: parseListNumber(cell(r, 9)),
    })
  }

  if (!orderNumber) warnings.push('Brak numeru zlecenia (wiersz „Zlecenie: …")')
  if (items.length === 0) warnings.push('Lista nie zawiera żadnych pozycji')
  if (totalValue != null && Math.abs(round2(items.reduce((s, i) => s + (i.value ?? 0), 0)) - totalValue) > 0.05) {
    warnings.push('Suma pozycji nie zgadza się z „Razem wartość materiału"')
  }

  return {
    kind: 'LM',
    order_number: orderNumber,
    created_at: createdAt,
    items,
    total_value: totalValue,
    total_need_value: totalNeed,
    warnings,
  }
}

/** „OF348/2026" z pliku vs numer zlecenia w programie (duplikat ma dopisek „ (2)") */
export function sameAluOrderNumber(fromFile: string, orderNumber: string): boolean {
  const norm = (s: string) => s.replace(/\s*\(\d+\)\s*$/, '').replace(/\s/g, '').toUpperCase()
  return norm(fromFile) !== '' && norm(fromFile) === norm(orderNumber)
}

/** Plik .xls/.xlsx → wiersze pierwszego arkusza (wartości jako sformatowany tekst). */
export function readMaterialListRows(data: ArrayBuffer): string[][] {
  const wb = XLSX.read(data, { type: 'array' })
  const name = wb.SheetNames.find((n) => /lista materiałowa/i.test(n)) ?? wb.SheetNames[0]
  if (!name) return []
  return XLSX.utils
    .sheet_to_json<string[]>(wb.Sheets[name], { header: 1, defval: '', raw: false, blankrows: false })
    .map((r) => r.map((c) => String(c)))
}
