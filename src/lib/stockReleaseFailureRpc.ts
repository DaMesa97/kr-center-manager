// D41 (28.11): zgłoszenie nieudanego zdjęcia z magazynu do Weryfikacji (rpc zglos_blad_zdjecia_magazynu,
// migracja 20261128030100). Woła się PO udanym zapisie etapu. Nigdy nie rzuca — false = nie zgłoszono
// (brak migracji, brak sieci) i komunikat każe zgłosić kierownikowi.
import { supabase } from '../supabaseClient'
import { releaseErrorText, type ReleaseFailureKind } from './stockReleaseFailure'

export async function reportStockReleaseFailure(p: {
  orderId: number
  kind: ReleaseFailureKind
  stageKey?: string | null
  error: unknown
  source: string
}): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('zglos_blad_zdjecia_magazynu', {
      p_order_id: p.orderId,
      p_kind: p.kind,
      p_stage_key: p.stageKey ?? null,
      p_error: releaseErrorText(p.error),
      p_source: p.source,
    })
    if (error) {
      console.error('zglos_blad_zdjecia_magazynu error:', error)
      return false
    }
    return true
  } catch (err) {
    console.error('zglos_blad_zdjecia_magazynu error:', err)
    return false
  }
}
