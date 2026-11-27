// Dzwonienie z CRM (Tymek 23.11): link `tel:` otwiera Ringostat Smart Phone (aplikacja ustawiona w Windows jako
// domyślna dla protokołu TEL). Przed wybraniem numeru pytamy — Smart Phone dzwoni od razu, przypadkowy klik = telefon do klienta.
// Wspólne dla numeru w karcie klienta (CrmTelefon) i przycisku „Zadzwoń” w „Do zrobienia”.
import { openExternalUrl } from '../hooks/useAluOrders'
import { appConfirm } from './appDialogs'

/** `tel:` tylko z cyframi i plusem — tyle przepuszcza bramka w Electronie */
export function telHref(telefon: string | null | undefined): string | null {
  const t = String(telefon ?? '').replace(/[\s\-().]/g, '')
  return /^\+?\d{6,15}$/.test(t) ? `tel:${t}` : null
}

/** Pyta „Zadzwonić do …?” i otwiera Smart Phone; false = brak numeru albo rezygnacja. */
export async function zadzwonDo(telefon: string | null | undefined, nazwa?: string | null): Promise<boolean> {
  const t = String(telefon ?? '').trim()
  const href = telHref(t)
  if (!href) return false
  const kto = (nazwa ?? '').trim()
  const ok = await appConfirm(kto ? `Zadzwonić do ${kto} (${t})? Ringostat Smart Phone wybierze numer od razu.` : `Zadzwonić pod ${t}? Ringostat Smart Phone wybierze numer od razu.`, { title: 'Zadzwonić?', confirmLabel: 'Zadzwoń', tone: 'success' })
  if (ok) void openExternalUrl(href)
  return ok
}
