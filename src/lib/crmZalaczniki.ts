// Załączniki maili w CRM (27.11) — czysta logika do listy plików.

type Zal = { nazwa?: string; typ?: string; rozmiar?: number }

/** Obrazek ze stopki / podpisu (image001.png, Outlook-xyz.png, „obraz” bez nazwy) — mały obrazek, chowamy go domyślnie. */
export function czyObrazekStopki(z: Zal): boolean {
  const nazwa = (z.nazwa ?? '').trim().toLowerCase()
  const obraz = (z.typ ?? '').toLowerCase().startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp)$/.test(nazwa)
  if (!obraz) return false
  const maly = !z.rozmiar || z.rozmiar < 60_000
  const nazwaStopki = nazwa === '' || nazwa === 'obraz' || /^(image|obraz|outlook-|logo|banner|signature|podpis)[\w.-]*\.(png|jpe?g|gif|bmp|webp)$/.test(nazwa)
  return maly && nazwaStopki
}

/** 1 234 567 → „1,2 MB”, 2 300 → „3 KB”. */
export function rozmiarPliku(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_048_576).toFixed(1).replace('.', ',')} MB`
  return `${Math.max(1, Math.round(b / 1024))} KB`
}
