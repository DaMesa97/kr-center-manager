// =====================================================================
// „Nagraj notatkę” (brief pkt 18): MediaRecorder z mikrofonu, maks. 3 min, licznik czasu.
// Po Stop oddaje blob rodzicowi (onRecorded) — karta klienta od razu wgrywa go do Storage
// i zleca ofertę (zlecOferteZNagrania), „Dodaj klienta” trzyma blob do zapisu leada.
// mimeType: audio/webm;codecs=opus, awaryjnie domyślny przeglądarki (Safari: mp4).
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, Trash2 } from 'lucide-react'
import { CRM_NAGRANIE_MAX_S } from '../../types/crm'
import Spinner from '../Spinner'

export type Nagranie = { blob: Blob; contentType: string; sekundy: number }

type Props = {
  /** po zatrzymaniu nagrania (albo po limicie czasu) */
  onRecorded: (n: Nagranie) => void | Promise<void>
  /** trwa upload/zlecenie — blokuje przycisk */
  busy?: boolean
  disabled?: boolean
  /** nagranie trzymane przez rodzica (Dodaj klienta): pokazujemy długość i „Usuń” */
  pending?: Nagranie | null
  onClear?: () => void
  size?: 'sm' | 'md'
}

const pickMime = (): string => {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

const fmtS = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function CrmNagrajNotatke({ onRecorded, busy = false, disabled = false, pending = null, onClear, size = 'md' }: Props) {
  const [recording, setRecording] = useState(false)
  const [sekundy, setSekundy] = useState(0)
  const [blad, setBlad] = useState<string | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  const cleanup = useCallback(() => {
    if (timerRef.current != null) window.clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  const stop = useCallback(() => {
    const r = recRef.current
    if (r && r.state !== 'inactive') r.stop()
  }, [])

  const start = async () => {
    setBlad(null)
    if (!supported) {
      setBlad('Ta przeglądarka nie obsługuje nagrywania. Użyj Chrome albo aplikacji na komputerze.')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      const name = (e as { name?: string })?.name
      setBlad(name === 'NotAllowedError' ? 'Brak zgody na mikrofon — zezwól w przeglądarce / systemie i spróbuj ponownie.' : name === 'NotFoundError' ? 'Nie znaleziono mikrofonu.' : 'Nie udało się uruchomić mikrofonu.')
      return
    }
    const mime = pickMime()
    let rec: MediaRecorder
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    } catch {
      rec = new MediaRecorder(stream)
    }
    chunksRef.current = []
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data)
    }
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type })
      const sek = Math.max(1, Math.round((Date.now() - startRef.current) / 1000))
      cleanup()
      setRecording(false)
      setSekundy(0)
      if (blob.size === 0) {
        setBlad('Nagranie jest puste — spróbuj jeszcze raz.')
        return
      }
      void onRecorded({ blob, contentType: type.split(';')[0], sekundy: sek })
    }
    recRef.current = rec
    streamRef.current = stream
    startRef.current = Date.now()
    setSekundy(0)
    setRecording(true)
    rec.start(1000)
    timerRef.current = window.setInterval(() => {
      const s = Math.round((Date.now() - startRef.current) / 1000)
      setSekundy(s)
      if (s >= CRM_NAGRANIE_MAX_S) stop()
    }, 500)
  }

  const btnCls = `btn ${size === 'sm' ? 'btn-sm ' : ''}btn-secondary`

  return (
    <span className="crm-rec">
      {recording ? (
        <button type="button" className={`${btnCls} crm-rec-btn--on`} onClick={stop} title="Zatrzymaj i wyślij nagranie">
          <Square size={14} /> Stop · {fmtS(sekundy)} / {fmtS(CRM_NAGRANIE_MAX_S)}
        </button>
      ) : pending ? (
        <>
          <span className="crm-rec-pending"><Mic size={14} /> nagranie {fmtS(pending.sekundy)}</span>
          {onClear && (
            <button type="button" className={btnCls} onClick={onClear} disabled={busy || disabled} title="Usuń nagranie">
              <Trash2 size={14} />
            </button>
          )}
        </>
      ) : (
        <button type="button" className={btnCls} onClick={() => void start()} disabled={busy || disabled} title="Powiedz, czego klient chce — system spisze nagranie i policzy ofertę">
          {busy ? <Spinner inline size={14} /> : <Mic size={14} />} Nagraj notatkę
        </button>
      )}
      {blad && <span className="crm-text-bad crm-rec-err">{blad}</span>}
    </span>
  )
}
