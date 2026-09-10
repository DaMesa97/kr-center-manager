import type { Order } from '../types'

// Wykrywanie podejrzanych dubli zleceń z konfiguratora.
// Tło: gałąź Make dopisuje zamówienia bota także do Excela (arkusz musi je
// mieć — pracują z niego handlowcy), więc to samo zamówienie klienta potrafi
// wejść dwa razy (source='bot' przez API + source='excel' z arkusza), a zdarza
// się też podwójna wysyłka z samego konfiguratora (dwa boty z różnymi
// recordId). Dedup intake'ów tego nie łapie (różne numery zleceń).
//
// Heurystyka: ta sama kategoria + NIEPUSTY numer zamówienia klienta, w grupie
// co najmniej dwa nieanulowane zlecenia i przynajmniej jedno z bota, a firmy
// zgodne tolerancyjnie (companiesMatch). Duble ręczne/excelowe bez bota
// pomijamy — to inny problem.

// Minimalny zestaw pól potrzebny do detekcji — Weryfikacja dociąga zlecenia
// wszystkich kategorii osobnym, okrojonym zapytaniem (orders w App trzyma
// tylko aktywną kategorię).
export type DuplicateCandidate = Pick<
  Order,
  | 'id' | 'order_number' | 'category' | 'company' | 'client_order_number' | 'source'
  | 'system' | 'model' | 'wing_color' | 'frame_color' | 'width' | 'height' | 'quantity'
  | 'extra_fields'
  // pod licznik etapów (countCompletedStages + hasGlassExtra):
  | 'production_stages' | 'top_light' | 'side_panel' | 'side_panel_a' | 'side_panel_b'
> & { created_at?: string | null }

export type DuplicateGroup = {
  category: string
  company: string
  clientOrderNumber: string
  // 'numer' = twarde (ten sam numer klienta); 'tresc' = pary bez numeru,
  // zgodne co do produktu i bliskie w czasie — do ręcznej oceny
  matchedBy: 'numer' | 'tresc'
  orders: DuplicateCandidate[]
}

const norm = (v: unknown): string => String(v ?? '').trim().toUpperCase()

// Numer klienta nadający się do porównania: min. 3 znaki i choć jedna
// litera/cyfra (odpada '-', '—', '...' itp.)
export const isComparableClientNumber = (value: unknown): boolean => {
  const n = norm(value)
  return n.length >= 3 && /[A-Z0-9]/.test(n)
}

// Firmy z dwóch kanałów bywają zapisane różnie: bot dostaje nazwę kontrahenta
// ze słownika aliasów ('PO DRZWI'), excel surową z arkusza ('PO DRZWI ŻORY').
// Pasują, gdy są równe albo wszystkie słowa krótszej zawierają się w dłuższej.
// ⚠️ Ta sama logika żyje w supabase/functions/orders-excel-intake
// (companiesMatch) — zmieniasz tu, zmień i tam.
export const companiesMatch = (a: unknown, b: unknown): boolean => {
  const tokens = (v: unknown): string[] =>
    String(v ?? '').trim().toUpperCase().split(/[\s#,]+/).filter(Boolean)
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.length === 0 || tb.length === 0) return false
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  return shorter.every((t) => longer.includes(t))
}

const isCancelled = (order: DuplicateCandidate): boolean => {
  const ef = order.extra_fields
  if (!ef || typeof ef !== 'object') return false
  return (ef as Record<string, unknown>).cancelled === true
}

export function findSuspectedDuplicates(orders: DuplicateCandidate[]): DuplicateGroup[] {
  // Grupujemy po kategorii + numerze klienta; firmy porównujemy tolerancyjnie
  // wewnątrz grupy (różne kanały zapisują je różnie).
  const groups = new Map<string, DuplicateCandidate[]>()

  for (const order of orders) {
    if (order.id === undefined) continue
    if (isCancelled(order)) continue
    if (!isComparableClientNumber(order.client_order_number)) continue
    const key = `${order.category} ${norm(order.client_order_number)}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(order)
    else groups.set(key, [order])
  }

  const result: DuplicateGroup[] = []
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue
    const bots = bucket.filter((o) => o.source === 'bot')
    if (bots.length === 0) continue
    // firmy zgodne z którymś botem — reszta bucketa to przypadkowa zbieżność numeru
    const members = bucket.filter(
      (o) => o.source === 'bot' || bots.some((b) => companiesMatch(b.company, o.company)),
    )
    if (members.length < 2) continue
    members.sort((a, b) => String(a.source ?? '').localeCompare(String(b.source ?? '')) || (a.id ?? 0) - (b.id ?? 0))
    const displayCompany = members.reduce(
      (best, o) => (String(o.company ?? '').length > best.length ? String(o.company ?? '') : best),
      '',
    )
    result.push({
      category: members[0].category,
      company: displayCompany,
      clientOrderNumber: members[0].client_order_number,
      matchedBy: 'numer',
      orders: members,
    })
  }

  // ── Fallback PO TREŚCI: pary bez porównywalnego numeru klienta ('-'/puste) ──
  // Bot i excel bez numeru nie łapią się na regułę wyżej, więc porównujemy
  // produkt (system+model+kolory+wymiary+ilość) w wąskim oknie czasowym.
  // Tylko do ręcznej oceny w Weryfikacji — treść może się powtórzyć legalnie.
  const CONTENT_WINDOW_MS = 3 * 24 * 3600 * 1000
  const contentGroups = new Map<string, DuplicateCandidate[]>()
  for (const order of orders) {
    if (order.id === undefined) continue
    if (isCancelled(order)) continue
    if (isComparableClientNumber(order.client_order_number)) continue
    const key = [
      order.category, norm(order.system), norm(order.model), norm(order.wing_color),
      norm(order.frame_color), norm(order.width), norm(order.height), Number(order.quantity) || 1,
    ].join('|')
    const bucket = contentGroups.get(key)
    if (bucket) bucket.push(order)
    else contentGroups.set(key, [order])
  }
  for (const bucket of contentGroups.values()) {
    if (bucket.length < 2) continue
    const bots = bucket.filter((o) => o.source === 'bot')
    if (bots.length === 0) continue
    const inWindow = (a: DuplicateCandidate, b: DuplicateCandidate): boolean => {
      const ta = Date.parse(String(a.created_at ?? ''))
      const tb = Date.parse(String(b.created_at ?? ''))
      if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false
      return Math.abs(ta - tb) <= CONTENT_WINDOW_MS
    }
    // grupa sensowna tylko gdy jest bot + coś jeszcze blisko w czasie
    const finalMembers = bucket.filter(
      (o) => o.source === 'bot'
        ? bucket.some((x) => x !== o && companiesMatch(o.company, x.company) && inWindow(o, x))
        : bots.some((b) => companiesMatch(b.company, o.company) && inWindow(o, b)),
    )
    if (finalMembers.length < 2 || !finalMembers.some((o) => o.source === 'bot')) continue
    finalMembers.sort((a, b) => String(a.source ?? '').localeCompare(String(b.source ?? '')) || (a.id ?? 0) - (b.id ?? 0))
    const displayCompany = finalMembers.reduce(
      (best, o) => (String(o.company ?? '').length > best.length ? String(o.company ?? '') : best),
      '',
    )
    result.push({
      category: finalMembers[0].category,
      company: displayCompany,
      clientOrderNumber: '(bez numeru)',
      matchedBy: 'tresc',
      orders: finalMembers,
    })
  }

  // Najświeższe grupy na górze (po najwyższym id w grupie)
  result.sort((a, b) => Math.max(...b.orders.map((o) => o.id ?? 0)) - Math.max(...a.orders.map((o) => o.id ?? 0)))
  return result
}
