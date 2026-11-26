import type { WarehouseComponent } from '../types'

/** Czytelna etykieta komponentu magazynu (drzwi wewnętrzne: model / rozmiar / kierunek / kolor). */
export function componentLabel(c: WarehouseComponent): string {
  const parts: string[] = [c.name]
  if (c.product_category === 'door_wing') {
    if (c.door_model) parts.push(c.door_model)
    if (c.door_size) parts.push(c.door_size)
    if (c.door_direction) parts.push(c.door_direction)
    if (c.door_color) parts.push(c.door_color)
  } else if (c.product_category === 'door_frame') {
    parts.push(c.door_frame_type === 'adjustable' ? 'regulowana' : 'prosta')
    if (c.door_frame_type === 'adjustable' && c.door_frame_code) parts.push(c.door_frame_code)
    if (c.door_size) parts.push(c.door_size)
    if (c.door_direction) parts.push(c.door_direction)
    if (c.door_color) parts.push(c.door_color)
  } else if (c.product_category === 'door_handle') {
    if (c.door_model) parts.push(c.door_model)
    if (c.door_color) parts.push(c.door_color)
    if (c.door_handle_shield) parts.push(c.door_handle_shield)
  } else if (c.product_category === 'door_hinge_cover') {
    if (c.door_color) parts.push(c.door_color)
  }
  return parts.filter(Boolean).join(' / ')
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')

/**
 * Wyszukiwanie komponentów po kodzie i etykiecie: każde słowo musi pasować,
 * bez ogonków. Komponenty drzwi wewnętrznych przed surowcami, potem alfabetycznie.
 */
export function searchComponents(components: WarehouseComponent[], query: string, limit = 60): WarehouseComponent[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  const hits = components.filter((c) => {
    if (!c.is_active) return false
    if (terms.length === 0) return true
    const hay = fold(`${c.code ?? ''} ${componentLabel(c)}`)
    return terms.every((t) => hay.includes(t))
  })
  hits.sort((a, b) => {
    const ra = a.product_category === 'raw' ? 1 : 0
    const rb = b.product_category === 'raw' ? 1 : 0
    return ra - rb || componentLabel(a).localeCompare(componentLabel(b), 'pl')
  })
  return hits.slice(0, limit)
}
