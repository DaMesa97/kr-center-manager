// D51 (28.11): jedno wykrywanie grupy Titan. Wcześniej trzy warunki: `!= null`, `Number(..) > 0` i niepusty tekst —
// dla 0 / '' / 'abc' wyniki się różniły (np. '' łapało się jako grupa w części miejsc). Grupa = id bazowego STA,
// więc poprawna wartość to dodatnia liczba całkowita (liczba albo tekst z liczbą).

/** Id grupy Titan z wartości extra_fields.titan_group albo null. */
export function titanGroupValue(v: unknown): number | null {
  if (v == null || typeof v === 'boolean') return null
  const s = String(v).trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** Id grupy Titan zlecenia (extra_fields.titan_group) albo null. */
export function titanGroupId(o: { extra_fields?: unknown } | null | undefined): number | null {
  const ef = o?.extra_fields
  if (typeof ef !== 'object' || ef === null || Array.isArray(ef)) return null
  return titanGroupValue((ef as Record<string, unknown>).titan_group)
}
