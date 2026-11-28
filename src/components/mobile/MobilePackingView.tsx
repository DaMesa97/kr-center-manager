import { appConfirm } from '../../lib/appDialogs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, ArrowLeft, Camera, Trash2 } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { humanizeAndLog } from '../../lib/friendlyError'
import { CAT_COLORS } from './mobileKategorie'
import { LIMIT_ZDJECIA_MS, czyLimitCzasu, komunikatWyjatku, zLimitemCzasu } from '../../lib/zLimitemCzasu'

type SearchResult = {
  id: number
  order_number: string
  category: string
  company: string
  model: string | null
  release_date: string | null
}

type Photo = {
  id: number
  public_url: string
  storage_path: string
}

const BUCKET = 'order-photos'


type Props = {
  userInitials: string
  userId: string
  /** D62: null = wszystkie kategorie; tablica = tylko zlecenia tych kategorii (role zawężone) */
  kategorie?: string[] | null
}

export default function MobilePackingView({ userInitials, userId, kategorie = null }: Props) {
  // klucz zamiast tablicy w zależnościach — nowa tablica z rodzica przy każdym renderze nie psuje wyszukiwania
  const kategorieKlucz = kategorie ? kategorie.join('|') : null
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SearchResult | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  // runda 10 (tester telefonu): błąd odczytu zdjęć wyglądał jak „Brak zdjęć — dodaj pierwsze”
  const [photosError, setPhotosError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchVersionRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (msg: string, sticky = false) => {
    // kasuj poprzedni timer — stary timeout gasił nowy toast po ułamku sekundy
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    setToast(humanizeAndLog(msg, 'mobile-pakowanie')) // techniczne błędy bazy/sieci po ludzku
    flashTimerRef.current = sticky ? null : setTimeout(() => setToast(null), 2500)
  }

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    const version = ++searchVersionRef.current
    if (trimmed.length < 1) { setResults([]); setSearching(false); return }
    setSearching(true)
    // wartości w cudzysłowach — składnia .or() PostgREST nie zna escapu
    // backslashem, a przecinek/nawias w nazwie firmy wywalał zapytanie
    const escaped = trimmed.replace(/["\\]/g, '')
    const pattern = `"%${escaped}%"`
    // D62: role zawężone (kierownik działu, pracownik produkcji) szukają tylko w swoich kategoriach
    const dozwolone = kategorieKlucz == null ? null : kategorieKlucz.split('|').filter(Boolean)
    if (dozwolone && dozwolone.length === 0) {
      setSearching(false)
      setResults([])
      flash('Nie masz przypisanych kategorii — poproś kierownika o ich ustawienie w profilu', true)
      return
    }
    let zapytanie = supabase
      .from('orders')
      .select('id, order_number, category, company, model, release_date')
      .or(`order_number.ilike.${pattern},company.ilike.${pattern},client_order_number.ilike.${pattern}`)
    if (dozwolone) zapytanie = zapytanie.in('category', dozwolone)
    const { data, error } = await zapytanie
      .order('order_date', { ascending: false })
      .limit(20)
    if (version !== searchVersionRef.current || !mountedRef.current) return
    setSearching(false)
    if (error) { flash('Błąd wyszukiwania'); return }
    setResults((data ?? []) as SearchResult[])
  }, [kategorieKlucz])

  const onQueryChange = (v: string) => {
    setQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(v), 300)
  }

  const loadPhotos = useCallback(async (orderId: number) => {
    const { data, error } = await supabase
      .from('order_photos')
      .select('id, public_url, storage_path')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
    if (!mountedRef.current) return
    setPhotosError(error ? humanizeAndLog(`Nie wczytano zdjęć — ${error.message}`, 'mobile-pakowanie') : null)
    setPhotos((data ?? []) as Photo[])
  }, [])

  const openOrder = async (order: SearchResult) => {
    setSelected(order)
    setPhotos([])
    await loadPhotos(order.id)
  }

  const backToSearch = () => {
    setSelected(null)
    setPhotos([])
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !selected) return
    // Skopiuj listę i od razu wyczyść input — zapobiega ponownemu wysłaniu tych samych plików
    const fileArr = Array.from(files)
    if (fileRef.current) fileRef.current.value = ''
    setUploading(true)
    try {
      let uploaded = 0
      let skipped = 0
      let failed = 0
      // D66: brak odpowiedzi serwera w limicie — zdjęcie mogło dojść; kolejnych nie wysyłamy (łącze leży)
      let bezOdpowiedzi = 0
      let przerwane = 0
      for (let i = 0; i < fileArr.length; i++) {
        const file = fileArr[i]
        // Akceptuj obrazy; HEIC z iPhone bywa z pustym type — odrzuć tylko jawnie nie-obrazy
        const isImage =
          file.type.startsWith('image/') ||
          file.type === '' ||
          /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
        if (!isImage) { skipped++; continue }
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const path = `${selected.id}/${stamp}_${Math.round(performance.now())}.${ext}`
        let inserted: unknown = null
        let insErr: unknown = null
        try {
          const up = await zLimitemCzasu(
            supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false }),
            LIMIT_ZDJECIA_MS,
          )
          if (up.error) { failed++; continue }
          const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
          const ins = await zLimitemCzasu(supabase
            .from('order_photos')
            .insert({
              order_id: selected.id,
              storage_path: path,
              public_url: urlData.publicUrl,
              uploaded_by: userId || null,
              uploaded_by_initials: userInitials || null,
            })
            .select('id, public_url, storage_path')
            .single())
          inserted = ins.data
          insErr = ins.error
        } catch (e) {
          if (!czyLimitCzasu(e)) { failed++; continue }
          // plik / wpis mógł się zapisać — nie sprzątamy (wiersz może istnieć), reszty nie wysyłamy
          bezOdpowiedzi++
          przerwane = fileArr.length - i - 1
          break
        }
        if (insErr) {
          // plik poszedł do storage, wiersz nie — sprzątnij sierotę
          void supabase.storage.from(BUCKET).remove([path])
          failed++
          continue
        }
        if (mountedRef.current) setPhotos((prev) => [inserted as Photo, ...prev])
        uploaded++
      }
      // Częściowa porażka NIE może wyglądać jak sukces — toast z liczbą
      // nieudanych wisi do zamknięcia (słabe WiFi gubiło zdjęcia po cichu)
      if (bezOdpowiedzi > 0) {
        const nieWyslane = failed + przerwane
        flash(
          `Dodano ${uploaded}; 1 zdjęcie bez odpowiedzi serwera (słaby internet?) — mogło się zapisać: wróć i otwórz zlecenie ponownie, zanim zrobisz je jeszcze raz` +
            (nieWyslane > 0 ? `. ${nieWyslane} NIE wysłano.` : ''),
          true,
        )
      } else if (failed > 0) {
        flash(`Dodano ${uploaded}, ${failed} NIE wysłano — zrób te zdjęcia jeszcze raz`, true)
      } else if (uploaded > 0) {
        flash(`Dodano ${uploaded} ${uploaded === 1 ? 'zdjęcie' : 'zdjęć'} ✓`)
      } else if (skipped > 0) {
        flash('Nie rozpoznano pliku jako zdjęcia')
      }
    } finally {
      if (mountedRef.current) setUploading(false)
    }
  }

  const deletePhoto = async (photo: Photo) => {
    if (!(await appConfirm('Usunąć zdjęcie?'))) return
    // RLS blokujące DELETE zwraca 0 wierszy bez błędu — bez tej kontroli
    // pracownik kasował PLIK ze storage zostawiając martwy wiersz
    try {
      const { data: deleted, error } = await zLimitemCzasu(supabase
        .from('order_photos')
        .delete()
        .eq('id', photo.id)
        .select('id'))
      if (error) { flash('Błąd usuwania'); return }
      if (!deleted || deleted.length === 0) { flash('Zdjęcia może usuwać tylko kierownik'); return }
      if (mountedRef.current) setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
      // wpis już skasowany — plik sprzątamy w tle (błąd / brak odpowiedzi nie blokuje ekranu)
      void supabase.storage.from(BUCKET).remove([photo.storage_path])
    } catch (e) {
      // D66: bez odpowiedzi — mogło się usunąć
      if (mountedRef.current) flash(komunikatWyjatku(e, 'Błąd usuwania'), true)
    }
  }

  return (
    <div className="mpack">
      {!selected ? (
        <div className="mpack-search">
          <div className="mpack-search-box">
            <Search size={20} />
            <input
              ref={inputRef}
              type="text"
              inputMode="search"
              placeholder="Nr zlecenia, firma…"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              autoFocus
            />
          </div>
          {searching && <div className="mpack-info">Szukam…</div>}
          {!searching && query.trim() && results.length === 0 && (
            <div className="mpack-info">Brak wyników</div>
          )}
          <div className="mpack-results">
            {results.map((r) => (
              <button key={r.id} type="button" className="mpack-result" onClick={() => void openOrder(r)}>
                <span className="mpack-cat" style={{ background: CAT_COLORS[r.category] ?? '#475569' }}>
                  {r.category === 'DrzwiWewnetrzne' ? 'Wewn.' : r.category}
                </span>
                <span className="mpack-result-main">
                  <span className="mpack-nr">{r.order_number}</span>
                  <span className="mpack-company">{r.company}</span>
                </span>
                {r.release_date && <span className="mpack-done">wydane</span>}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mpack-detail">
          <button type="button" className="mpack-back" onClick={backToSearch}>
            <ArrowLeft size={18} /> Wróć do wyszukiwania
          </button>

          <div className="mpack-order-card">
            <div className="mpack-order-top">
              <span className="mpack-cat" style={{ background: CAT_COLORS[selected.category] ?? '#475569' }}>
                {selected.category === 'DrzwiWewnetrzne' ? 'Wewn.' : selected.category}
              </span>
              <span className="mpack-order-nr">{selected.order_number}</span>
            </div>
            <div className="mpack-order-company">{selected.company}</div>
            {selected.model && <div className="mpack-order-model">{selected.model}</div>}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <button
            type="button"
            className="mpack-shoot"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            <Camera size={26} />
            {uploading ? 'Wysyłanie…' : 'Zrób zdjęcie'}
          </button>

          <div className="mpack-photos">
            {photosError ? (
              <div className="mpack-info" style={{ color: '#b91c1c' }}>{photosError}</div>
            ) : photos.length === 0 ? (
              <div className="mpack-info">Brak zdjęć — dodaj pierwsze</div>
            ) : (
              <div className="mpack-photo-grid">
                {photos.map((p) => (
                  <div key={p.id} className="mpack-photo">
                    <img src={p.public_url} alt="Zdjęcie" loading="lazy" />
                    <button type="button" className="mpack-photo-del" onClick={() => void deletePhoto(p)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className="mpack-toast">{toast}</div>}
    </div>
  )
}
