import { useState } from 'react'
import ComponentPickerDialog from './ComponentPickerDialog'
import { mapOptimaCode } from '../lib/optimaRo'
import { internalDoorComponents } from '../lib/internalWarehouse'
import { searchDoorComponentsRemote } from '../lib/warehouseStocked'
import type { ToastVariant, WarehouseComponent } from '../types'

type Props = {
  code: string
  name?: string | null
  group?: string | null
  components: WarehouseComponent[]
  /** komponent z istniejącego powiązania (edycja) */
  currentId?: number | null
  pushToast: (message: string, variant: ToastVariant) => void
  onDone: () => void | Promise<void>
  onClose: () => void
}

/**
 * „Powiąż z komponentem": zapis do optima_component_map (upsert po kodzie)
 * i od razu przepięcie wszystkich pozycji z tym kodem. Import stosuje
 * powiązanie przy kolejnych RO — robi się je raz na kod.
 */
export default function OptimaCodeLinkDialog({ code, name, group, components, currentId = null, pushToast, onDone, onClose }: Props) {
  const [busy, setBusy] = useState(false)

  const save = async (component: WarehouseComponent | null) => {
    setBusy(true)
    try {
      const n = await mapOptimaCode(code, component?.id ?? null)
      pushToast(
        component
          ? `Kod ${code} powiązany z „${component.name}” — przepięto pozycji: ${n}`
          : `Usunięto powiązanie kodu ${code} — pozycji bez komponentu: ${n}`,
        'success',
      )
      await onDone()
      onClose()
    } catch (e) {
      console.error('[optima] powiązanie kodu', code, e)
      pushToast(`Nie zapisano powiązania: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  // Podpowiedź wyszukiwania: pierwsze słowa nazwy z Optimy (model), bez kodu
  const initialQuery = String(name ?? '').split(/\s+/).filter((w) => w.length > 2).slice(0, 2).join(' ')

  return (
    <ComponentPickerDialog
      title={currentId ? 'Zmień powiązanie kodu z Optimy' : 'Powiąż kod z Optimy z komponentem'}
      subject={
        <>
          <div>
            <span className="optima-code">{code}</span> {name || ''}
          </div>
          {group && <div className="muted">Grupa w Optimie: {group}</div>}
          <div className="muted">
            Powiązanie zapisuje się raz na kod: wszystkie pozycje z tym kodem dostaną ten komponent teraz i przy kolejnych importach.
          </div>
        </>
      }
      // tylko drzwi wewnętrzne — bez surowców i bez Bastiona (osobny produkt)
      components={internalDoorComponents(components)}
      remoteSearch={searchDoorComponentsRemote}
      initialQuery={initialQuery}
      currentId={currentId}
      busy={busy}
      onPick={(c) => void save(c)}
      onClear={currentId ? () => void save(null) : undefined}
      onClose={onClose}
    />
  )
}
