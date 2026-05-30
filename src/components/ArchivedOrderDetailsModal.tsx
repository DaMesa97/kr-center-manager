import { createPortal } from 'react-dom'
import type { ArchivedOrder } from '../types'

type Props = {
  open: boolean
  order: ArchivedOrder | null
  onClose: () => void
  onCreateComplaint: (archivedOrder: ArchivedOrder) => void
}

type FieldDef = { key: keyof ArchivedOrder; label: string }

const BASIC_FIELDS: FieldDef[] = [
  { key: 'order_number', label: 'Numer zamówienia' },
  { key: 'category', label: 'Kategoria' },
  { key: 'company', label: 'Firma' },
  { key: 'client_order_number', label: 'Nr zamówienia klienta' },
  { key: 'quantity', label: 'Ilość' },
  { key: 'order_date', label: 'Data zamówienia' },
  { key: 'release_date', label: 'Data wydania' },
  { key: 'production_day', label: 'Dzień produkcji' },
]

const CONFIG_FIELDS: FieldDef[] = [
  { key: 'system', label: 'System' },
  { key: 'model', label: 'Model' },
  { key: 'wing_color', label: 'Kolor skrzydła' },
  { key: 'frame_color', label: 'Kolor ościeżnicy' },
  { key: 'threshold_color', label: 'Kolor progu' },
  { key: 'width', label: 'Szerokość' },
  { key: 'height', label: 'Wysokość' },
  { key: 'direction', label: 'Kierunek' },
  { key: 'opening', label: 'Otwieranie' },
  { key: 'glazing', label: 'Szklenie' },
  { key: 'decorative_panel', label: 'Panel dekoracyjny' },
  { key: 'hardware', label: 'Okucia' },
  { key: 'handle', label: 'Pochwyt' },
]

const EXTRA_FIELDS: FieldDef[] = [
  { key: 'notes', label: 'Uwagi' },
  { key: 'defects', label: 'Braki' },
  { key: 'configurator_value', label: 'Wartość konfiguratora' },
  { key: 'info', label: 'Info' },
  { key: 'archived_at', label: 'Data archiwizacji' },
  { key: 'archived_by', label: 'Archiwizował' },
  { key: 'archive_reason', label: 'Powód archiwizacji' },
]

function valueToText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function renderSection(title: string, fields: FieldDef[], order: ArchivedOrder) {
  return (
    <div className="stats-card">
      <h3>{title}</h3>
      <table className="audit-diff-table">
        <tbody>
          {fields.map((field) => (
            <tr key={field.key}>
              <th>{field.label}</th>
              <td>{valueToText(order[field.key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ArchivedOrderDetailsModal({ open, order, onClose, onCreateComplaint }: Props) {
  if (!open || !order) return null

  return createPortal(
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="audit-details-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="audit-details-header">
          <h2>Szczegóły archiwalnego zamówienia nr {order.order_number}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
            X
          </button>
        </div>

        <div className="stats-grid">
          {renderSection('Podstawowe', BASIC_FIELDS, order)}
          {renderSection('Konfiguracja', CONFIG_FIELDS, order)}
          {renderSection('Dodatkowe', EXTRA_FIELDS, order)}
        </div>

        <div className="order-form-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>
            Zamknij
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onCreateComplaint(order)}>
            Utwórz reklamację
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
