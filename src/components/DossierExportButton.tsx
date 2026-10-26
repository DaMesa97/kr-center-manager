import { useState } from 'react'
import { exportOrderDossierZip } from '../utils/dossierExportZip'
import type { ToastVariant } from '../types'

// Eksport teczki zlecenia dla audytora: ZIP ze spisem treści i wszystkimi
// wersjami dokumentów (ZKP 5.9, zał. 6.34). Wspólny dla szczegółów zlecenia
// i wyszukiwarki „od tabliczki".

type Props = {
  orderId: number
  pushToast: (message: string, variant: ToastVariant) => void
  className?: string
}

export default function DossierExportButton({ orderId, pushToast, className = 'btn btn-sm btn-secondary' }: Props) {
  const [progress, setProgress] = useState<string | null>(null)

  const run = async () => {
    setProgress('Przygotowuję…')
    try {
      const res = await exportOrderDossierZip(orderId, setProgress)
      if (!res.ok) {
        pushToast(`Eksport teczki nie powiódł się: ${res.error}`, 'error')
      } else if (res.failed > 0) {
        pushToast(`Zapisano ${res.fileName} — ${res.failed} plików nie udało się pobrać (oznaczone w spisie treści)`, 'error')
      } else {
        pushToast(`Zapisano ${res.fileName} (spis treści + ${res.files} plików)`, 'success')
      }
    } catch (e) {
      pushToast(`Eksport teczki nie powiódł się: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setProgress(null)
    }
  }

  return (
    <button
      type="button"
      className={className}
      disabled={progress !== null}
      onClick={() => void run()}
      title="Jeden plik ZIP: spis treści (PDF) + wszystkie wersje dokumentów zlecenia, także wycofane — dla audytora"
    >
      {progress ?? '📦 Eksport teczki (ZIP)'}
    </button>
  )
}
