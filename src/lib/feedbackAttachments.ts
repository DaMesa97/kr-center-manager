import type { ClipboardEvent as ReactClipboardEvent } from 'react'
import { supabase } from '../supabaseClient'

/**
 * Zrzuty ekranu do zgłoszeń (#125, Łukasz 12.11.2026): pliki w bucket
 * `feedback-attachments` (publiczny odczyt jak order-photos), lista w kolumnie
 * `feedback.attachments` jako [{path, url, name, size}]. Obsługa: wybór pliku,
 * przeciągnięcie, Ctrl+V ze schowka (Wycinanie → Ctrl+V w polu treści).
 */
export type FeedbackAttachment = { path: string; url: string; name: string; size: number }

export const FEEDBACK_BUCKET = 'feedback-attachments'
export const MAX_FEEDBACK_FILES = 6
const MAX_BYTES = 10 * 1024 * 1024
const IMAGE_RE = /^image\/(jpeg|png|webp|gif)$/

export const isFeedbackImage = (f: File): boolean => IMAGE_RE.test(f.type)

/** Tylko obrazki z listy plików (input/drop); reszta pomijana. */
export function pickImageFiles(list: FileList | File[] | null | undefined): File[] {
  if (!list) return []
  return Array.from(list as ArrayLike<File>).filter(isFeedbackImage)
}

/** Obrazki wklejone ze schowka (Ctrl+V) — Windows daje je jako items typu file. */
export function imageFilesFromClipboard(e: ReactClipboardEvent | ClipboardEvent): File[] {
  const items = e.clipboardData?.items
  if (!items) return []
  const out: File[] = []
  for (const it of Array.from(items)) {
    if (it.kind !== 'file') continue
    const f = it.getAsFile()
    if (f && isFeedbackImage(f)) out.push(f)
  }
  return out
}

/** Dolepia nowe pliki do listy z limitem ilości i rozmiaru; zwraca też komunikat o pominiętych. */
export function mergePendingFiles(current: File[], incoming: File[]): { files: File[]; skipped: string | null } {
  const skipped: string[] = []
  const files = [...current]
  for (const f of incoming) {
    if (!isFeedbackImage(f)) { skipped.push(`${f.name || 'plik'} (tylko JPG/PNG/WEBP/GIF)`); continue }
    if (f.size > MAX_BYTES) { skipped.push(`${f.name || 'plik'} (> 10 MB)`); continue }
    if (files.length >= MAX_FEEDBACK_FILES) { skipped.push(`${f.name || 'plik'} (limit ${MAX_FEEDBACK_FILES} zrzutów)`); continue }
    files.push(f)
  }
  return { files, skipped: skipped.length ? `Pominięto: ${skipped.join(', ')}` : null }
}

export function parseAttachments(raw: unknown): FeedbackAttachment[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((a) => (typeof a === 'object' && a !== null ? (a as Record<string, unknown>) : null))
    .filter((a): a is Record<string, unknown> => !!a && typeof a.url === 'string' && typeof a.path === 'string')
    .map((a) => ({ path: String(a.path), url: String(a.url), name: String(a.name ?? ''), size: Number(a.size ?? 0) }))
}

const extOf = (f: File): string => {
  const fromName = f.name.split('.').pop()
  if (fromName && /^[a-z0-9]{2,5}$/i.test(fromName)) return fromName.toLowerCase()
  return f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : f.type === 'image/gif' ? 'gif' : 'jpg'
}

/**
 * Wysyła pliki do bucketu. Zwraca wpisy dla udanych; błędy zgłasza przez onError
 * (jeden plik nie blokuje reszty). `prefix` = podkatalog (np. id zgłoszenia lub 'new').
 */
export async function uploadFeedbackAttachments(
  files: File[],
  opts: { prefix?: string; onError?: (msg: string) => void } = {},
): Promise<FeedbackAttachment[]> {
  const out: FeedbackAttachment[] = []
  const prefix = (opts.prefix ?? 'new').replace(/[^a-z0-9_-]/gi, '') || 'new'
  for (const f of files) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = `${prefix}/${stamp}_${Math.round(performance.now() * 1000) % 1_000_000}.${extOf(f)}`
    const { error } = await supabase.storage.from(FEEDBACK_BUCKET).upload(path, f, { cacheControl: '3600', upsert: false })
    if (error) {
      opts.onError?.(`Nie wysłano ${f.name || 'zrzutu'}: ${error.message}`)
      continue
    }
    const { data } = supabase.storage.from(FEEDBACK_BUCKET).getPublicUrl(path)
    out.push({ path, url: data.publicUrl, name: f.name || `zrzut.${extOf(f)}`, size: f.size })
  }
  return out
}

/** Usuwa pliki z bucketu (po usunięciu załącznika w edycji); błędy ignorowane — wpis w tabeli i tak znika. */
export async function removeFeedbackAttachments(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  try {
    await supabase.storage.from(FEEDBACK_BUCKET).remove(paths)
  } catch {
    /* osierocony plik w buckecie nie szkodzi */
  }
}
