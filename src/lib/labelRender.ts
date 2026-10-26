import QRCode from 'qrcode'
import type { AluPosition, Order } from '../types'
import { ALU_CONSTRUCTION_LABELS, ALU_REALIZACJA_LABELS } from '../constants'
import { aluLoadingDate, aluOrderExtra, formatAluDims, formatAluGlass, formatPlDateWithDow } from './alu'

export type LabelTemplate = {
  id: number
  category: string
  name: string
  html: string
  width_mm: number
  height_mm: number
  is_default: boolean
}

const str = (v: unknown): string => (v == null ? '' : String(v)).trim()

// Escape danych zamówienia wstawianych w HTML etykiety (firma/uwagi mogą zawierać
// znaki HTML) — zapobiega wykonaniu np. <img onerror=...> w podglądzie iframe.
export const escapeHtml = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const extraField = (o: Order, key: string): unknown => {
  const ef = o.extra_fields
  return ef && typeof ef === 'object' ? (ef as Record<string, unknown>)[key] : undefined
}

// Numer zamówienia partnera (jak w potwierdzeniu anulowania w useOrders):
// Disting → STA, STA → ST (Titan) albo Disting, ST → STA
const partnerNumber = (o: Order): string => {
  if (o.category === 'Disting') return str(o.sta_sheet)
  if (o.category === 'STA') return str(o.st_sheet) || str(o.disting_sheet)
  if (o.category === 'ST') return str(o.sta_ref)
  return str(o.disting_sheet) || str(o.sta_sheet) || str(o.st_sheet)
}

// Wszystkie dostępne pola do wstawienia na etykiecie ({{key}}) + opis dla edytora.
// 'qr' obsługiwane osobno (generuje kod QR z ID zlecenia).
export const LABEL_FIELDS: { key: string; label: string; value: (o: Order) => string }[] = [
  { key: 'nr_zlecenia',     label: 'Nr zlecenia',            value: (o) => str(o.order_number) },
  { key: 'firma',           label: 'Firma',                  value: (o) => str(o.company) },
  { key: 'model',           label: 'Model',                  value: (o) => str(o.model) },
  { key: 'system',          label: 'System',                 value: (o) => str(o.system) },
  { key: 'kolor',           label: 'Kolor skrzydła',         value: (o) => str(o.wing_color) },
  { key: 'kolor_oscieznicy',label: 'Kolor ościeżnicy',       value: (o) => str(o.frame_color) },
  { key: 'kolor_wf',        label: 'Kolor skrzydła WF',      value: (o) => str(extraField(o, 'kolor_skrzydla_wf')) },
  { key: 'kolor_oscieznicy_wf', label: 'Kolor ościeżnicy WF', value: (o) => str(extraField(o, 'kolor_oscieznicy_wf')) },
  { key: 'kolor_progu',     label: 'Kolor progu',            value: (o) => str(o.threshold_color) },
  { key: 'szerokosc',       label: 'Szerokość',              value: (o) => str(o.width) },
  { key: 'wysokosc',        label: 'Wysokość',               value: (o) => str(o.height) },
  { key: 'wymiar',          label: 'Wymiar (S × W)',         value: (o) => [str(o.width), str(o.height)].filter(Boolean).join(' × ') },
  { key: 'kierunek',        label: 'Kierunek',               value: (o) => str(o.direction) },
  { key: 'otwieranie',      label: 'Otwieranie',             value: (o) => str(o.opening) },
  { key: 'szklenie',        label: 'Szklenie',               value: (o) => str(o.glazing) },
  { key: 'panel',           label: 'Panel dekoracyjny',      value: (o) => str(o.decorative_panel) },
  { key: 'okucia',          label: 'Okucia',                 value: (o) => str(o.hardware) },
  { key: 'pochwyt',         label: 'Pochwyt',                value: (o) => str(o.handle) },
  { key: 'wizjer',          label: 'Wizjer',                 value: (o) => str(o.peephole) },
  { key: 'elektrozaczep',   label: 'Elektrozaczep',          value: (o) => str(o.electric_strike) },
  { key: 'naswietle',       label: 'Naświetle górne',        value: (o) => str(o.top_light) },
  { key: 'naswietle_szkl',  label: 'Szklenie naświetla',     value: (o) => str(o.top_light_glazing) },
  { key: 'dostawka',        label: 'Dostawka boczna',        value: (o) => str(o.side_panel_a) || str(o.side_panel) },
  { key: 'dostawka_szkl',   label: 'Szklenie dostawki',      value: (o) => str(o.side_panel_a_glazing) || str(o.side_panel_glazing) },
  { key: 'dostawka_b',      label: 'Dostawka boczna B',      value: (o) => str(o.side_panel_b) },
  { key: 'dostawka_b_szkl', label: 'Szklenie dostawki B',    value: (o) => str(o.side_panel_b_glazing) },
  { key: 'panel_boczny_k',  label: 'Panel boczny klamkowy',  value: (o) => str((o as Record<string, unknown>).bastion_side_panel_k) },
  { key: 'panel_boczny_p',  label: 'Panel boczny przeciwkl.',value: (o) => str((o as Record<string, unknown>).bastion_side_panel_p) },
  { key: 'panel_gorny',     label: 'Panel górny',            value: (o) => str((o as Record<string, unknown>).bastion_top_panel) },
  { key: 'poszerzenie',     label: 'Poszerzenie',            value: (o) => str(o.extension) },
  { key: 'oslonki',         label: 'Osłonki',                value: (o) => str((o as Record<string, unknown>).oslonki) },
  { key: 'podwalina',       label: 'Podwalina',              value: (o) => str(extraField(o, 'podwalina')) },
  { key: 'intarsja',        label: 'Intarsja',               value: (o) => str(o.intarsja) },
  { key: 'ilosc',           label: 'Ilość',                  value: (o) => str(o.quantity) },
  { key: 'produkcja',       label: 'Dzień produkcji',        value: (o) => str(o.production_day) },
  { key: 'data',            label: 'Data zlecenia',          value: (o) => str(o.order_date) },
  { key: 'nr_klienta',      label: 'Nr zamówienia klienta',  value: (o) => str(o.client_order_number) },
  { key: 'nr_partnera',     label: 'Nr zam. powiązanego',    value: (o) => partnerNumber(o) },
  { key: 'nr_arkusza',      label: 'Nr z arkusza (konflikt)',value: (o) => str(extraField(o, 'sheet_number_conflict')) },
  { key: 'uwagi',           label: 'Uwagi',                  value: (o) => str(o.notes) },
  { key: 'kategoria',       label: 'Kategoria',              value: (o) => str(o.category) },
  { key: 'qr',              label: 'Kod QR (ID zlecenia)',   value: () => '' },
]

// Stolarka aluminiowa: etykieta per SZTUKA pozycji (pozycja z ilością 3 = 3 etykiety
// „1/3, 2/3, 3/3”). Pola {{alu_*}} czytają pozycję; bez kontekstu alu dają „-”.
export type AluLabelCtx = {
  position: AluPosition
  piece: number
  /** ZKP 5.9: numer konstrukcji RRRR/ZZ/PP tej sztuki ('' = zlecenie nieuruchomione) */
  constructionNo?: string
}

export const ALU_LABEL_FIELDS: { key: string; label: string; value: (o: Order, c: AluLabelCtx) => string }[] = [
  { key: 'alu_poz',          label: 'Alu: nr pozycji',          value: (_o, c) => str(c.position.pos_no) },
  { key: 'alu_sztuka',       label: 'Alu: sztuka (np. 2/5)',     value: (_o, c) => `${c.piece}/${Math.max(1, Number(c.position.quantity) || 1)}` },
  // ZKP 5.9 — numer nanoszony na elementy w toku produkcji
  { key: 'alu_nr_konstrukcji', label: 'Alu: nr konstrukcji (RRRR/ZZ/PP)', value: (_o, c) => c.constructionNo ?? '' },
  { key: 'alu_opis',         label: 'Alu: opis pozycji',        value: (_o, c) => str(c.position.description) },
  { key: 'alu_typ',          label: 'Alu: typ konstrukcji',     value: (_o, c) => ALU_CONSTRUCTION_LABELS[c.position.construction_type] ?? str(c.position.construction_type) },
  { key: 'alu_system',       label: 'Alu: system',              value: (_o, c) => str(c.position.system) },
  { key: 'alu_wymiar',       label: 'Alu: wymiar S × W',        value: (_o, c) => { const d = formatAluDims(c.position.width_mm, c.position.height_mm); return d ? `${d} mm` : '' } },
  { key: 'alu_kolor_profili',label: 'Alu: kolor profili',       value: (_o, c) => str(c.position.profile_color) },
  { key: 'alu_kolor_okuc',   label: 'Alu: kolor okuć',          value: (_o, c) => str(c.position.hardware_color) },
  { key: 'alu_szklo',        label: 'Alu: szkło',               value: (_o, c) => formatAluGlass(c.position.glass) },
  { key: 'alu_wypelnienia',  label: 'Alu: wypełnienia',         value: (_o, c) => str(c.position.fillings) },
  { key: 'alu_okucia',       label: 'Alu: okucia (uwagi)',      value: (_o, c) => str(c.position.notes?.okucia) },
  { key: 'alu_klamka',       label: 'Alu: klamka',              value: (_o, c) => str(c.position.notes?.klamka) },
  { key: 'alu_dodatki',      label: 'Alu: dodatki',             value: (_o, c) => str(c.position.notes?.dodatki) },
  { key: 'alu_prog',         label: 'Alu: próg',                value: (_o, c) => str(c.position.notes?.prog) },
  { key: 'alu_uwagi',        label: 'Alu: inne uwagi',          value: (_o, c) => str(c.position.notes?.inne) },
  { key: 'alu_masa',         label: 'Alu: masa pozycji',        value: (_o, c) => (c.position.weight_kg ? `${c.position.weight_kg} kg` : '') },
  { key: 'alu_lp',           label: 'Alu: nr listy produkcyjnej', value: (o) => aluOrderExtra(o).lp_number },
  { key: 'alu_termin',       label: 'Alu: termin',              value: (o) => { const d = aluOrderExtra(o).deadline; return d ? formatPlDateWithDow(d) : '' } },
  { key: 'alu_zaladunek',    label: 'Alu: dzień załadunku',     value: (o) => { const d = aluLoadingDate(aluOrderExtra(o).deadline); return d ? formatPlDateWithDow(d) : '' } },
  { key: 'alu_realizacja',   label: 'Alu: realizacja',          value: (o) => (ALU_REALIZACJA_LABELS[aluOrderExtra(o).realizacja] ?? '').toUpperCase() },
]

async function qrImage(order: Order): Promise<string> {
  const qrPayload = str(order.id) || str(order.order_number)
  try {
    const dataUrl = await QRCode.toDataURL(qrPayload, { margin: 0, width: 240 })
    return `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain" alt="QR" />`
  } catch {
    return ''
  }
}

async function substituteFields(template: LabelTemplate, order: Order, alu?: AluLabelCtx): Promise<string> {
  const qrImg = await qrImage(order)
  let body = template.html
  if (alu) {
    for (const field of ALU_LABEL_FIELDS) body = body.split(`{{${field.key}}}`).join(escapeHtml(field.value(order, alu)) || '-')
  }
  for (const field of LABEL_FIELDS) {
    // Puste pole tekstowe → "-" (QR nie podlega tej regule; escapujemy dane usera)
    const val = field.key === 'qr' ? qrImg : (escapeHtml(field.value(order)) || '-')
    body = body.split(`{{${field.key}}}`).join(val)
  }
  // Nieznane/literówkowe placeholdery {{...}} → "-" (żeby nie drukować surowych klamr)
  return body.replace(/\{\{\s*[\wąćęłńóśźż.-]+\s*\}\}/gi, '-')
}

// Body etykiety (podstawione pola + QR) + wymiary — do samodzielnego druku
// albo do sklejenia w zbiorczy PDF (printBundle)
export async function renderLabelBody(
  template: LabelTemplate,
  order: Order,
  alu?: AluLabelCtx,
): Promise<{ body: string; widthMm: number; heightMm: number }> {
  return {
    body: await substituteFields(template, order, alu),
    widthMm: Number(template.width_mm) || 100,
    heightMm: Number(template.height_mm) || 50,
  }
}

/** Kilka etykiet w JEDNYM dokumencie (strona = etykieta) — jedno zadanie druku zamiast N. */
export function labelPagesHtml(bodies: string[], widthMm: number, heightMm: number, title: string): string {
  const pages = bodies
    .map(
      (b, i) =>
        `<div style="width:${widthMm}mm;height:${heightMm}mm;box-sizing:border-box;overflow:hidden;${i < bodies.length - 1 ? 'page-break-after:always;' : ''}">${b}</div>`,
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title || 'etykiety')}</title><style>
    @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; }
  </style></head><body>${pages}</body></html>`
}

// Renderuje finalny HTML etykiety: podstawia pola + generuje QR + ustawia rozmiar strony
export async function renderLabelHtml(template: LabelTemplate, order: Order, alu?: AluLabelCtx): Promise<string> {
  const body = await substituteFields(template, order, alu)

  const w = Number(template.width_mm) || 100
  const h = Number(template.height_mm) || 50
  // <title> = firma + numer zlecenia: przy "Zapisz jako PDF" Windows bierze
  // nazwę pliku z tytułu strony (bez tego proponował krzaki z adresu data:)
  const docTitle = escapeHtml(
    [str(order.company), str(order.order_number)].filter(Boolean).join(' ') || 'etykieta',
  )
  return `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title><style>
    @page { size: ${w}mm ${h}mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    body { width: ${w}mm; height: ${h}mm; box-sizing: border-box; font-family: Arial, sans-serif; overflow: hidden; }
  </style></head><body>${body}</body></html>`
}
