// =====================================================================
// Stany specjalne etapu produkcji (decyzja Tymka 2.11.2026, zgłoszenie #73).
//
// Komórka etapu trzyma zwykle inicjały osoby („KW"). Z Excela wróciły dwa
// stany, których inicjałami nie da się zapisać:
//   '#ND'          — NIE DOTYCZY: etap w tym zleceniu nie jest potrzebny
//                    (np. klient bierze samo skrzydło). Liczy się jako
//                    ZROBIONY dla kolejnych etapów i kompletności, ale NIE
//                    jest niczyją pracą (statystyki go pomijają) i NIE wydaje
//                    z magazynu.
//   '#WS' / '#WS:powód' — WSTRZYMANE: czekamy (decyzja klienta, materiał).
//                    Liczy się jako NIEZROBIONY, blokuje NASTĘPNE na Moim
//                    stanowisku, pracownik widzi powód.
// Ustawia i zdejmuje je kierownik (prawy klik na komórce); w bazie pilnuje
// tego update_order_stage (P0404). Wartości zaczynają się od '#', żeby nigdy
// nie pomylić ich z inicjałami.
// =====================================================================

export const STAGE_NA = '#ND'
export const STAGE_HOLD = '#WS'

const norm = (v: unknown): string => String(v ?? '').trim()

export function isStageSpecial(v: unknown): boolean {
  return norm(v).startsWith('#')
}

export function isStageNA(v: unknown): boolean {
  return norm(v).toUpperCase() === STAGE_NA
}

export function isStageHold(v: unknown): boolean {
  return norm(v).toUpperCase().startsWith(STAGE_HOLD)
}

/** Powód wstrzymania ('' gdy brak albo to nie wstrzymanie). */
export function stageHoldReason(v: unknown): string {
  if (!isStageHold(v)) return ''
  return norm(v).slice(STAGE_HOLD.length).replace(/^:/, '').trim()
}

/** Wartość do zapisu dla „wstrzymane" z opcjonalnym powodem. */
export function holdValue(reason: string): string {
  const r = reason.trim().replace(/\s+/g, ' ')
  return r ? `${STAGE_HOLD}:${r}` : STAGE_HOLD
}

/**
 * Etap „zrobiony" na potrzeby kolejnych etapów, kompletności zestawu i pasków
 * postępu: dowolna niepusta wartość (inicjały, 'T'/'X' z migracji, NIE DOTYCZY)
 * poza WSTRZYMANE. Wcześniej wszędzie było `trim() !== ''`.
 */
export function isStageDone(v: unknown): boolean {
  const t = norm(v)
  return t !== '' && !isStageHold(t)
}

/** Inicjały osoby z komórki — '' dla stanów specjalnych (do statystyk / „kto zrobił"). */
export function stageInitials(v: unknown): string {
  const t = norm(v)
  return isStageSpecial(t) ? '' : t
}

/** Co pokazać w komórce / na liście: „—" dla nie dotyczy, „⏸" dla wstrzymane, inaczej wartość. */
export function stageDisplay(v: unknown): string {
  if (isStageNA(v)) return '—'
  if (isStageHold(v)) return '⏸'
  return norm(v)
}

/** Opis po ludzku (tooltip, historia, audyt). */
export function stageLabel(v: unknown): string {
  if (isStageNA(v)) return 'nie dotyczy'
  if (isStageHold(v)) {
    const r = stageHoldReason(v)
    return r ? `wstrzymane: ${r}` : 'wstrzymane'
  }
  return norm(v)
}

/** Tytuł komórki dla stanu specjalnego (undefined dla zwykłych wartości). */
export function stageSpecialTitle(v: unknown): string | undefined {
  if (isStageNA(v)) return 'Nie dotyczy — ten etap nie jest potrzebny w tym zleceniu (ustawia kierownik)'
  if (isStageHold(v)) {
    const r = stageHoldReason(v)
    return `Wstrzymane${r ? `: ${r}` : ''}`
  }
  return undefined
}
