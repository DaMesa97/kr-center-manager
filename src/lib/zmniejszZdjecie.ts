// =====================================================================
// D67 (28.11.2026): zdjęcia zleceń zmniejszane przed wysłaniem.
// Bucket `order-photos` przyjmuje tylko JPG / PNG / WEBP / GIF do 10 MB. Telefon wysyłał oryginał
// (12–50 MP, bywa HEIC z iPhone'a) — duże albo HEIC dawało „zrób jeszcze raz”, a ponowienie nic nie dawało.
// Teraz: zdjęcie dekodujemy w przeglądarce, zmniejszamy tak, żeby dłuższy bok miał najwyżej 1600 px,
// i kodujemy jako JPEG (canvas — bez nowych zależności). HEIC przechodzi, jeśli przeglądarka umie go
// odczytać (Safari na iPhonie umie; Chrome na Androidzie / komputerze nie — wtedy jasny komunikat).
// Małe zdjęcia w obsługiwanym formacie idą bez zmian (nie tracimy jakości bez potrzeby).
// =====================================================================

/** Dłuższy bok po zmniejszeniu (px). */
export const ZDJECIE_MAX_PX = 1600
/** Jakość JPEG (0–1). 1600 px przy 0.82 to zwykle 250–600 KB. */
export const ZDJECIE_JAKOSC = 0.82
/** Typy przyjmowane przez bucket order-photos. */
export const ZDJECIE_TYPY_BUCKETU = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
/** Limit rozmiaru bucketu order-photos (bajty). */
export const ZDJECIE_LIMIT_BUCKETU = 10 * 1024 * 1024
/** Plik w obsługiwanym formacie i nie większy niż to (a wymiary w limicie) idzie bez przekodowania. */
export const ZDJECIE_ORYGINAL_DO = 2 * 1024 * 1024

export const KOMUNIKAT_ZLY_FORMAT =
  'Tego zdjęcia nie da się odczytać (np. format HEIC z iPhone\'a). W ustawieniach aparatu wybierz format „Najbardziej zgodny” (JPG) albo zrób zdjęcie przyciskiem w programie.'
export const KOMUNIKAT_ZA_DUZE = 'Zdjęcie jest za duże (ponad 10 MB) i nie dało się go zmniejszyć.'

export type ZdjecieGotowe = {
  ok: true
  blob: Blob
  /** typ MIME do uploadu (contentType) */
  typ: string
  /** rozszerzenie pliku w storage, bez kropki */
  rozszerzenie: string
  /** true = przekodowane / zmniejszone w przeglądarce */
  zmniejszone: boolean
}
export type ZdjecieBlad = { ok: false; blad: string }
export type WynikZdjecia = ZdjecieGotowe | ZdjecieBlad

/** Odczytany obraz: wymiary (już po obrocie z EXIF) i źródło do narysowania na canvasie. */
export type ObrazZdjecia = {
  szer: number
  wys: number
  zrodlo: unknown
  zamknij: () => void
}

export type ZaleznosciZdjecia = {
  dekoduj: (plik: Blob) => Promise<ObrazZdjecia>
  koduj: (obraz: ObrazZdjecia, szer: number, wys: number, jakosc: number) => Promise<Blob | null>
}

/** Wymiary po zmniejszeniu: dłuższy bok najwyżej `max`, proporcje zachowane, nigdy nie powiększamy. */
export function wymiaryPoZmniejszeniu(szer: number, wys: number, max: number = ZDJECIE_MAX_PX): { szer: number; wys: number } {
  if (!(szer > 0) || !(wys > 0)) return { szer: 0, wys: 0 }
  const dluzszy = Math.max(szer, wys)
  if (dluzszy <= max) return { szer: Math.round(szer), wys: Math.round(wys) }
  const skala = max / dluzszy
  return { szer: Math.max(1, Math.round(szer * skala)), wys: Math.max(1, Math.round(wys * skala)) }
}

export function czyTypBucketu(typ: string): boolean {
  return (ZDJECIE_TYPY_BUCKETU as readonly string[]).includes(typ)
}

/** Czy wysłać plik bez przekodowania (format bucketu, mały plik, wymiary w limicie). */
export function czyWyslacOryginal(plik: { type: string; size: number }, szer: number, wys: number, max: number = ZDJECIE_MAX_PX): boolean {
  return czyTypBucketu(plik.type) && plik.size <= ZDJECIE_ORYGINAL_DO && Math.max(szer, wys) <= max
}

export function rozszerzenieDlaTypu(typ: string): string {
  switch (typ) {
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    default: return 'jpg'
  }
}

function oryginal(plik: Blob): WynikZdjecia {
  if (!czyTypBucketu(plik.type)) return { ok: false, blad: KOMUNIKAT_ZLY_FORMAT }
  if (plik.size > ZDJECIE_LIMIT_BUCKETU) return { ok: false, blad: KOMUNIKAT_ZA_DUZE }
  return { ok: true, blob: plik, typ: plik.type, rozszerzenie: rozszerzenieDlaTypu(plik.type), zmniejszone: false }
}

/**
 * Przygotowuje zdjęcie do wysłania do bucketu order-photos.
 * Nie rzuca wyjątków — zwraca { ok:false, blad } z komunikatem dla pracownika.
 */
export async function przygotujZdjecie(
  plik: Blob,
  zaleznosci: ZaleznosciZdjecia = domyslneZaleznosci,
  max: number = ZDJECIE_MAX_PX,
  jakosc: number = ZDJECIE_JAKOSC,
): Promise<WynikZdjecia> {
  let obraz: ObrazZdjecia
  try {
    obraz = await zaleznosci.dekoduj(plik)
  } catch {
    // przeglądarka nie umie odczytać (np. HEIC w Chrome) — wyślij oryginał, jeśli bucket go przyjmie
    return oryginal(plik)
  }
  try {
    if (!(obraz.szer > 0) || !(obraz.wys > 0)) return oryginal(plik)
    if (czyWyslacOryginal(plik, obraz.szer, obraz.wys, max)) return oryginal(plik)
    const cel = wymiaryPoZmniejszeniu(obraz.szer, obraz.wys, max)
    let blob: Blob | null = null
    try {
      blob = await zaleznosci.koduj(obraz, cel.szer, cel.wys, jakosc)
    } catch {
      blob = null
    }
    if (!blob || blob.size === 0) return oryginal(plik)
    if (blob.size > ZDJECIE_LIMIT_BUCKETU) return { ok: false, blad: KOMUNIKAT_ZA_DUZE }
    return { ok: true, blob, typ: 'image/jpeg', rozszerzenie: 'jpg', zmniejszone: true }
  } finally {
    try { obraz.zamknij() } catch { /* bez znaczenia */ }
  }
}

// ---------------------------------------------------------------------
// Domyślna implementacja w przeglądarce (createImageBitmap / <img> + canvas).
// ---------------------------------------------------------------------
async function dekodujWPrzegladarce(plik: Blob): Promise<ObrazZdjecia> {
  if (typeof createImageBitmap === 'function') {
    try {
      // from-image: obrót z EXIF (zdjęcie z telefonu trzymanego pionowo)
      const bmp = await createImageBitmap(plik, { imageOrientation: 'from-image' })
      return { szer: bmp.width, wys: bmp.height, zrodlo: bmp, zamknij: () => bmp.close() }
    } catch {
      // np. starszy Safari bez obsługi opcji — próbujemy przez <img>
    }
  }
  const url = URL.createObjectURL(plik)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { szer: img.naturalWidth, wys: img.naturalHeight, zrodlo: img, zamknij: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

function kodujWPrzegladarce(obraz: ObrazZdjecia, szer: number, wys: number, jakosc: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = szer
  canvas.height = wys
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  // JPEG nie ma przezroczystości — białe tło zamiast czarnego pod PNG
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, szer, wys)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(obraz.zrodlo as CanvasImageSource, 0, 0, szer, wys)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', jakosc))
}

export const domyslneZaleznosci: ZaleznosciZdjecia = {
  dekoduj: dekodujWPrzegladarce,
  koduj: kodujWPrzegladarce,
}
