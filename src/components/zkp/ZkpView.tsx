import { useState } from 'react'
import { useZkp } from '../../hooks/useZkp'
import { ZKP_ROLE_LABELS } from '../../constants'
import { zkpCanDecide, zkpCanReceive } from '../../lib/zkp'
import ZkpReceiptsPanel from './ZkpReceiptsPanel'
import ZkpSuppliersPanel from './ZkpSuppliersPanel'
import ZkpCriticalPanel from './ZkpCriticalPanel'
import ZkpTracePanel from './ZkpTracePanel'
import type { CurrentUser, ToastVariant } from '../../types'

// Zakładka ZKP AS 75EI — etap F: przyjęcia komponentów krytycznych z partiami
// (zał. 6.24), wykaz dostawców kwalifikowanych (6.31), lista komponentów
// krytycznych (6.10.5). Zapis wyłącznie funkcjami bazy (role ZKP na koncie).
// Pierwsza podzakładka: wyszukiwarka „od tabliczki” + eksport teczki (tylko odczyt).

type Sub = 'tabliczka' | 'przyjecia' | 'dostawcy' | 'komponenty'

type Props = {
  currentUser: CurrentUser | null
  pushToast: (message: string, variant: ToastVariant) => void
}

export default function ZkpView({ currentUser, pushToast }: Props) {
  const [sub, setSub] = useState<Sub>('tabliczka')
  const zkp = useZkp(pushToast, true)
  const roles = currentUser?.zkp_roles ?? []
  const canReceive = zkpCanReceive(roles)
  const canDecide = zkpCanDecide(roles)
  const quarantine = zkp.lots.filter((l) => l.decision === 'kwarantanna').length

  const tab = (key: Sub, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={sub === key}
      className={`btn btn-sm ${sub === key ? 'btn-primary' : 'btn-secondary'}`}
      onClick={() => setSub(key)}
    >
      {label}
    </button>
  )

  return (
    <div className="zkp-view">
      <div className="zkp-view-head">
        <div className="subtab-bar" role="tablist" aria-label="ZKP — sekcje">
          {tab('tabliczka', 'Szukaj po tabliczce')}
          {tab('przyjecia', `Przyjęcia i partie (6.24)${quarantine ? ` · kwarantanna ${quarantine}` : ''}`)}
          {tab('dostawcy', 'Dostawcy kwalifikowani (6.31)')}
          {tab('komponenty', 'Komponenty krytyczne (6.10.5)')}
        </div>
        <span className="zkp-roles" title="Role ZKP nadaje admin w Użytkownikach">
          Twoje role ZKP:{' '}
          {roles.length ? roles.map((r) => ZKP_ROLE_LABELS[r] ?? r).join(', ') : <em>brak — tylko podgląd</em>}
        </span>
      </div>

      {sub === 'tabliczka' && <ZkpTracePanel pushToast={pushToast} />}
      {sub === 'przyjecia' && <ZkpReceiptsPanel zkp={zkp} canReceive={canReceive} canDecide={canDecide} onGoTo={setSub} />}
      {sub === 'dostawcy' && <ZkpSuppliersPanel zkp={zkp} canEdit={canDecide} />}
      {sub === 'komponenty' && <ZkpCriticalPanel zkp={zkp} canEdit={canDecide} />}
    </div>
  )
}

export type ZkpData = ReturnType<typeof useZkp>
export type ZkpSub = Sub
