import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Trash2, X } from 'lucide-react'
import { supabase } from '../supabaseClient'
import type { OrderPhoto, ToastVariant } from '../types'

type Props = {
  orderId: number
  currentUserId: string
  currentUserInitials: string
  pushToast?: (msg: string, variant: ToastVariant) => void
}

const BUCKET = 'order-photos'

export default function OrderPhotos({ orderId, currentUserId, currentUserInitials, pushToast }: Props) {
  const [photos, setPhotos] = useState<OrderPhoto[]>([])
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchPhotos = useCallback(async () => {
    const { data, error } = await supabase
      .from('order_photos')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
    if (error) return // tabela może nie istnieć jeszcze
    setPhotos((data ?? []) as OrderPhoto[])
  }, [orderId])

  useEffect(() => { void fetchPhotos() }, [fetchPhotos])

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        const ext = file.name.split('.').pop() || 'jpg'
        // unikalna ścieżka — bez Date.now w nazwie polegamy na losowości czasu uploadu
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const path = `${orderId}/${stamp}_${Math.round(performance.now())}.${ext}`

        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
          cacheControl: '3600',
          upsert: false,
        })
        if (upErr) {
          pushToast?.(`Błąd wysyłania zdjęcia: ${upErr.message}`, 'error')
          continue
        }

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
        const publicUrl = urlData.publicUrl

        const { data: inserted, error: insErr } = await supabase
          .from('order_photos')
          .insert({
            order_id: orderId,
            storage_path: path,
            public_url: publicUrl,
            uploaded_by: currentUserId || null,
            uploaded_by_initials: currentUserInitials || null,
          })
          .select('*')
          .single()

        if (insErr) {
          pushToast?.(`Błąd zapisu zdjęcia: ${insErr.message}`, 'error')
          continue
        }
        setPhotos((prev) => [inserted as OrderPhoto, ...prev])
      }
      pushToast?.('Zdjęcia dodane', 'success')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleDelete = async (photo: OrderPhoto) => {
    if (!window.confirm('Usunąć to zdjęcie?')) return
    const { error: dbErr } = await supabase.from('order_photos').delete().eq('id', photo.id)
    if (dbErr) {
      pushToast?.(`Błąd usuwania zdjęcia: ${dbErr.message}`, 'error')
      return
    }
    // Storage usuwamy best-effort — rekord w DB już skasowany
    await supabase.storage.from(BUCKET).remove([photo.storage_path])
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
  }

  return (
    <div className="order-photos">
      <div className="order-photos-header">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          <Camera size={14} /> {uploading ? 'Wysyłanie…' : 'Dodaj zdjęcie'}
        </button>
        {photos.length > 0 && <span className="order-photos-count">{photos.length} zdjęć</span>}
      </div>

      {photos.length > 0 && (
        <div className="order-photos-grid">
          {photos.map((p) => (
            <div key={p.id} className="order-photo-thumb">
              <img
                src={p.public_url}
                alt="Zdjęcie zamówienia"
                onClick={() => setLightbox(p.public_url)}
                loading="lazy"
              />
              <button
                type="button"
                className="order-photo-delete"
                onClick={() => void handleDelete(p)}
                title="Usuń"
              >
                <Trash2 size={13} />
              </button>
              {p.uploaded_by_initials && (
                <span className="order-photo-author">{p.uploaded_by_initials}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="order-photo-lightbox" onClick={() => setLightbox(null)}>
          <button type="button" className="order-photo-lightbox-close" onClick={() => setLightbox(null)}>
            <X size={20} />
          </button>
          <img src={lightbox} alt="Podgląd" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
