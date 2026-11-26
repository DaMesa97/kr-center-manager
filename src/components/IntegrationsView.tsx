import { useState, type ComponentProps } from 'react'
import ApiKeysView from './ApiKeysView'
import IntegrationsSettingsView from './config/IntegrationsSettingsView'
import OptimaSyncCard from './config/OptimaSyncCard'
import type { ToastVariant } from '../types'

/**
 * Ustawienia → Integracje (porządki menu, beta.86): wszystko, co łączy program
 * ze światem zewnętrznym, w jednym miejscu — klucze API dla konfiguratora / Excela,
 * adresy webhooków Make (np. „Ponów wysyłkę do Optimy") i stan importu drzwi
 * wewnętrznych z Optimy. Wcześniej Klucze API były osobną pozycją menu,
 * a webhooki podzakładką Konfiguracji.
 */
type Sub = 'Klucze API' | 'Make / Optima' | 'Optima → Drzwi wewnętrzne'

type Props = ComponentProps<typeof ApiKeysView> & {
  pushToast: (message: string, variant: ToastVariant) => void
  /** „Synchronizuj teraz" importu RO z Optimy — kierownicy */
  canSyncOptima: boolean
}

export default function IntegrationsView({ pushToast, canSyncOptima, ...apiKeysProps }: Props) {
  const [sub, setSub] = useState<Sub>('Klucze API')
  const tab = (key: Sub, title?: string) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={sub === key}
      className={`btn btn-sm ${sub === key ? 'btn-primary' : 'btn-secondary'}`}
      onClick={() => setSub(key)}
      title={title}
    >
      {key}
    </button>
  )

  return (
    <div className="integrations-view">
      <div className="subtab-bar" role="tablist" aria-label="Integracje — sekcje">
        {tab('Klucze API', 'Klucze dla konfiguratora i arkusza Excel: generowanie, dezaktywacja, statystyki użycia')}
        {tab('Make / Optima', 'Adresy webhooków Make, m.in. „Ponów wysyłkę do Optimy" (RO)')}
        {tab('Optima → Drzwi wewnętrzne', 'Import rezerwacji odbiorcy (RO) z baz KR Center i MR Profil: ostatnie uruchomienie, liczniki, błędy')}
      </div>
      {sub === 'Klucze API' ? (
        <ApiKeysView {...apiKeysProps} />
      ) : sub === 'Make / Optima' ? (
        <IntegrationsSettingsView pushToast={pushToast} />
      ) : (
        <OptimaSyncCard canSync={canSyncOptima} pushToast={pushToast} />
      )}
    </div>
  )
}
