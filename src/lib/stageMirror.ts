// =====================================================================
// Mirror etapów między zamówieniami powiązanymi (Disting Plus / Titan).
// Źródło prawdy mapowania — spójne z syncMirrorStagesToLinkedOrder
// w useOrders: STA e3/e4/e5 → sta_* u partnera, Disting e1/e2_*/e5 → dist_*.
// =====================================================================

export function mirrorStageKey(category: string | null | undefined, stageKey: string): string | null {
  if (category === 'STA') {
    if (stageKey === 'e3') return 'sta_e3'
    if (stageKey === 'e4') return 'sta_e4'
    if (stageKey === 'e5') return 'sta_e5'
  } else if (category === 'Disting') {
    if (stageKey === 'e1') return 'dist_e1'
    if (stageKey === 'e2_1') return 'dist_e2_1'
    if (stageKey === 'e2_2') return 'dist_e2_2'
    if (stageKey === 'e5') return 'dist_e5'
  }
  return null
}
