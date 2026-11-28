// D47: WZORZEC do porównań — dawne liczenie CategoryStatsDashboard (przed przeniesieniem do bazy), skopiowane 1:1
// z useMemo komponentu (stan 1f41820 / 237c8cc), tylko `new Date()` zamienione na parametr `now`.
// Używane w statsAgregaty.test.ts (losowe zlecenia) i w porównaniu na danych produkcji (raport D47).
// NIE zmieniać — to definicja „obecnego liczenia”.
import type { Order } from '../../types'
import { isReleaseDateEmpty } from '../../utils'
import { isOptimaClosed } from '../../lib/optimaRo'

function isCancelled(o: Order): boolean {
  const extra = o.extra_fields as Record<string, unknown> | null | undefined
  return extra?.cancelled === true
}

function zrealizowane(o: Order): boolean {
  return !isReleaseDateEmpty(o.release_date) || isOptimaClosed(o)
}

export function staryWidokKategorii(category: string, orders: Order[], rangeMonths: number, now: Date, canon?: (name: unknown) => string) {
  const filteredOrdersNonCancelled = orders.filter((o) => {
    if (o.category !== category) return false
    if (isCancelled(o)) return false
    return true
  })

  const completedCategoryOrders = orders.filter(
    (o) => o.category === category && !isCancelled(o) && !isReleaseDateEmpty(o.release_date),
  )

  const bezPrawdziwejDaty = completedCategoryOrders.filter((o) => (o.extra_fields as Record<string, unknown> | null)?.release_date_szacunkowa === true).length

  const productionData = (() => {
    const map = new Map<string, number>()
    for (let i = rangeMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map.set(key, 0)
    }
    for (const o of completedCategoryOrders) {
      if ((o.extra_fields as Record<string, unknown> | null)?.release_date_szacunkowa === true) continue
      const key = String(o.release_date ?? '').slice(0, 7)
      if (map.has(key)) {
        map.set(key, (map.get(key) ?? 0) + (Number(o.quantity) || 0))
      }
    }
    return Array.from(map.entries()).map(([month, qty]) => ({ month, qty }))
  })()

  const systemData = (() => {
    const map = new Map<string, number>()
    for (const o of completedCategoryOrders) {
      const sys = (o.system || '').trim() || '(brak)'
      map.set(sys, (map.get(sys) ?? 0) + (Number(o.quantity) || 0))
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  })()

  const statusData = (() => {
    const allInCategory = orders.filter((o) => o.category === category)
    let done = 0
    let cancelled = 0
    let inProgress = 0
    for (const o of allInCategory) {
      const extra = o.extra_fields as Record<string, unknown> | null | undefined
      const q = Number(o.quantity) || 0
      if (extra?.cancelled === true) {
        cancelled += q
      } else if (zrealizowane(o)) {
        done += q
      } else {
        inProgress += q
      }
    }
    return [
      { name: 'Zrealizowane', value: done, color: '#10b981' },
      { name: 'W produkcji', value: inProgress, color: '#3b82f6' },
      { name: 'Anulowane', value: cancelled, color: '#ef4444' },
    ]
  })()

  const topCompaniesData = (() => {
    const map = new Map<string, number>()
    for (const o of filteredOrdersNonCancelled) {
      const company = (canon ? canon(o.company) : (o.company || '').trim()) || '(brak)'
      map.set(company, (map.get(company) ?? 0) + (Number(o.quantity) || 0))
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  })()

  const realizationTimes = (() => {
    const times: Array<{ order: Order; days: number; releaseMonth: string }> = []
    for (const o of filteredOrdersNonCancelled) {
      if (!o.release_date || isReleaseDateEmpty(o.release_date)) continue
      if ((o.extra_fields as Record<string, unknown> | null)?.release_date_szacunkowa === true) continue
      const createdStr = o.order_date || (o as { created_at?: string }).created_at
      if (!createdStr) continue
      const created = new Date(createdStr)
      const released = new Date(o.release_date)
      const diffMs = released.getTime() - created.getTime()
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24))
      if (days < 0) continue
      const releaseMonth = `${released.getFullYear()}-${String(released.getMonth() + 1).padStart(2, '0')}`
      times.push({ order: o, days, releaseMonth })
    }
    return times
  })()

  const avgRealizationDays = realizationTimes.length === 0 ? null : Math.round(realizationTimes.reduce((s, t) => s + t.days, 0) / realizationTimes.length)
  const minRealizationDays = realizationTimes.length === 0 ? null : Math.min(...realizationTimes.map((t) => t.days))
  const maxRealizationDays = realizationTimes.length === 0 ? null : Math.max(...realizationTimes.map((t) => t.days))

  const avgRealizationByMonth = (() => {
    const map = new Map<string, { sum: number; count: number }>()
    for (let i = rangeMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map.set(key, { sum: 0, count: 0 })
    }
    for (const t of realizationTimes) {
      const existing = map.get(t.releaseMonth)
      if (existing) {
        existing.sum += t.days
        existing.count += 1
      }
    }
    return Array.from(map.entries()).map(([month, { sum, count }]) => ({
      month,
      avg: count > 0 ? Math.round(sum / count) : 0,
    }))
  })()

  const byWeekday = (() => {
    const counts = [0, 0, 0, 0, 0, 0, 0]
    for (const o of filteredOrdersNonCancelled) {
      const createdStr = o.order_date || (o as { created_at?: string }).created_at
      if (!createdStr) continue
      const d = new Date(createdStr)
      const dayOfWeek = d.getDay()
      counts[dayOfWeek] += Number(o.quantity) || 1
    }
    return [
      { name: 'Pon', value: counts[1] },
      { name: 'Wt', value: counts[2] },
      { name: 'Śr', value: counts[3] },
      { name: 'Czw', value: counts[4] },
      { name: 'Pt', value: counts[5] },
      { name: 'Sob', value: counts[6] },
      { name: 'Ndz', value: counts[0] },
    ]
  })()

  const byModel = (() => {
    const map = new Map<string, number>()
    for (const o of filteredOrdersNonCancelled) {
      const model = o.model?.trim() || '(brak)'
      map.set(model, (map.get(model) ?? 0) + (Number(o.quantity) || 1))
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
  })()

  const byWingColor = (() => {
    const map = new Map<string, number>()
    for (const o of filteredOrdersNonCancelled) {
      const color = o.wing_color?.trim() || '(brak)'
      map.set(color, (map.get(color) ?? 0) + (Number(o.quantity) || 1))
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
  })()

  return {
    bezPrawdziwejDaty,
    productionData,
    systemData,
    statusData,
    topCompaniesData,
    realizacja:
      avgRealizationDays === null
        ? null
        : { avg: avgRealizationDays, min: minRealizationDays as number, max: maxRealizationDays as number, count: realizationTimes.length },
    avgRealizationByMonth,
    byWeekday,
    byModel,
    byWingColor,
  }
}
