// D33 (28.11): pole „Zakres ościeżnicy” w formularzu Bastion — nie tylko dla ościeżnicy regulowanej, ale też dla
// zabudowy (ZAB.OŚC.METAL., ZABUDOWA BOLD / KĄTOWA — w Excelu 94 zlecenia mają zakres przy zabudowie).

/** Typ ościeżnicy, przy którym zakres ma sens: regulowana albo zabudowa. */
export function typOscieznicyZZakresem(frameType: string | null | undefined): boolean {
  const t = String(frameType ?? '').toUpperCase()
  return t.includes('REGULOWAN') || t.includes('ZAB')
}

/** Pokaż pole zakresu: typ z zakresem albo zakres już wpisany (nie chowamy danych z Excela). */
export function pokazZakresOscieznicy(frameType: string | null | undefined, frameRange: string | null | undefined): boolean {
  return typOscieznicyZZakresem(frameType) || String(frameRange ?? '').trim() !== ''
}
