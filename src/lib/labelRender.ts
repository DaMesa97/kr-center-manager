import QRCode from 'qrcode'
import type { Order } from '../types'

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

// Wszystkie dostępne pola do wstawienia na etykiecie ({{key}}) + opis dla edytora.
// 'qr' obsługiwane osobno (generuje kod QR z ID zlecenia).
export const LABEL_FIELDS: { key: string; label: string; value: (o: Order) => string }[] = [
  { key: 'nr_zlecenia',     label: 'Nr zlecenia',            value: (o) => str(o.order_number) },
  { key: 'firma',           label: 'Firma',                  value: (o) => str(o.company) },
  { key: 'model',           label: 'Model',                  value: (o) => str(o.model) },
  { key: 'system',          label: 'System',                 value: (o) => str(o.system) },
  { key: 'kolor',           label: 'Kolor skrzydła',         value: (o) => str(o.wing_color) },
  { key: 'kolor_oscieznicy',label: 'Kolor ościeżnicy',       value: (o) => str(o.frame_color) },
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
  { key: 'poszerzenie',     label: 'Poszerzenie',            value: (o) => str(o.extension) },
  { key: 'oslonki',         label: 'Osłonki',                value: (o) => str((o as Record<string, unknown>).oslonki) },
  { key: 'ilosc',           label: 'Ilość',                  value: (o) => str(o.quantity) },
  { key: 'produkcja',       label: 'Dzień produkcji',        value: (o) => str(o.production_day) },
  { key: 'data',            label: 'Data zlecenia',          value: (o) => str(o.order_date) },
  { key: 'nr_klienta',      label: 'Nr zamówienia klienta',  value: (o) => str(o.client_order_number) },
  { key: 'uwagi',           label: 'Uwagi',                  value: (o) => str(o.notes) },
  { key: 'kategoria',       label: 'Kategoria',              value: (o) => str(o.category) },
  { key: 'qr',              label: 'Kod QR (ID zlecenia)',   value: () => '' },
]

// Renderuje finalny HTML etykiety: podstawia pola + generuje QR + ustawia rozmiar strony
export async function renderLabelHtml(template: LabelTemplate, order: Order): Promise<string> {
  const qrPayload = str(order.id) || str(order.order_number)
  let qrImg = ''
  try {
    const dataUrl = await QRCode.toDataURL(qrPayload, { margin: 0, width: 240 })
    qrImg = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain" alt="QR" />`
  } catch {
    qrImg = ''
  }

  let body = template.html
  for (const field of LABEL_FIELDS) {
    // Puste pole tekstowe → "-" (QR nie podlega tej regule)
    const val = field.key === 'qr' ? qrImg : (field.value(order) || '-')
    body = body.split(`{{${field.key}}}`).join(val)
  }
  // Nieznane/literówkowe placeholdery {{...}} → "-" (żeby nie drukować surowych klamr)
  body = body.replace(/\{\{\s*[\wąćęłńóśźż.-]+\s*\}\}/gi, '-')

  const w = Number(template.width_mm) || 100
  const h = Number(template.height_mm) || 50
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${w}mm ${h}mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    body { width: ${w}mm; height: ${h}mm; box-sizing: border-box; font-family: Arial, sans-serif; overflow: hidden; }
  </style></head><body>${body}</body></html>`
}
