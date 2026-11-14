// =====================================================================
// Użytkownicy → „Dostęp do CRM Po Drzwi” (tylko superadmin, brief 14.11.2026 pkt 2).
// Checkbox per użytkownik = wiersz w crm.dostep (insert {user_id, nadal} / delete).
// Superadmini mają dostęp z racji roli — pokazani jako zaznaczeni, bez możliwości
// odznaczenia. RLS: pisze tylko superadmin, więc dla innych sekcja się nie renderuje.
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DbProfileRow, ToastVariant } from '../../types'
import { fetchCrmDostep, grantCrmDostep, revokeCrmDostep, type CrmError } from '../../hooks/useCrm'
import Spinner from '../Spinner'

type Props = {
  profiles: DbProfileRow[]
  currentUserId?: string
  pushToast: (message: string, variant: ToastVariant) => void
  /** po zmianie dostępu (np. własnego) — App odświeża widoczność zakładki */
  onChanged?: () => void
}

export default function CrmAccessSection({ profiles, currentUserId, pushToast, onChanged }: Props) {
  const [granted, setGranted] = useState<Map<string, string> | null>(null) // user_id → nadano_at
  const [error, setError] = useState<CrmError | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const { data, error: err } = await fetchCrmDostep()
    setError(err)
    setGranted(err ? null : new Map(data.map((r) => [r.user_id, r.nadano_at])))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sorted = useMemo(
    () => [...profiles].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'pl')),
    [profiles],
  )

  const toggle = async (row: DbProfileRow, on: boolean) => {
    if (!currentUserId) return
    setBusy((prev) => new Set(prev).add(row.id))
    const err = on ? await grantCrmDostep(row.id, currentUserId) : await revokeCrmDostep(row.id)
    setBusy((prev) => {
      const next = new Set(prev)
      next.delete(row.id)
      return next
    })
    if (err) {
      pushToast(`Nie udało się zmienić dostępu: ${err.message}`, 'error')
      return
    }
    pushToast(on ? `${row.full_name} ma dostęp do CRM Po Drzwi` : `${row.full_name} nie ma już dostępu do CRM Po Drzwi`, 'success')
    await load()
    onChanged?.()
  }

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pl-PL')
  }

  return (
    <section className="crm-access" aria-labelledby="crm-access-title">
      <h3 id="crm-access-title" className="crm-access-title">Dostęp do CRM Po Drzwi</h3>
      <p className="user-modal-hint">
        Zakładkę „CRM Po Drzwi” (leady, rozmowy, oferty) widzą wyłącznie superadministratorzy i osoby zaznaczone niżej.
        Rola administratora sama z siebie dostępu nie daje.
      </p>
      {error ? (
        <p className="crm-error">{error.message}</p>
      ) : granted == null ? (
        <Spinner center label="Ładowanie listy dostępu…" />
      ) : (
        <ul className="crm-access-list">
          {sorted.map((p) => {
            const isSuper = p.role === 'superadmin'
            const has = isSuper || granted.has(p.id)
            const at = granted.get(p.id)
            return (
              <li key={p.id} className={`crm-access-item${has ? ' crm-access-item--on' : ''}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={has}
                    disabled={isSuper || busy.has(p.id)}
                    onChange={(e) => void toggle(p, e.target.checked)}
                  />
                  <span className="crm-access-name">{p.full_name || p.initials || p.id}</span>
                  <span className="crm-access-meta">
                    {isSuper ? 'superadministrator — zawsze' : has && at ? `od ${fmtDate(at)}` : p.role ? p.role.replace(/_/g, ' ') : ''}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
