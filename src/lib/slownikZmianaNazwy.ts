// =====================================================================
// D60 (28.11.2026): zmiana nazwy wartości słownika przenosi nazwę wszędzie, gdzie jest użyta.
// Baza: config_option_rename(p_id, p_nowa, p_tylko_podglad) — migracja 20261128055000.
// Najpierw podgląd (te same liczby co prawdziwa zmiana), okno z listą miejsc, dopiero potem zmiana.
// Zamówienia (historyczne i otwarte) nie są zmieniane — patrz komentarz w migracji.
// =====================================================================

export type WynikZmianyNazwy = {
  podglad?: boolean
  zmieniono?: boolean
  bez_zmian?: boolean
  blokada?: string | null
  stara?: string
  nowa?: string
  kategoria?: string
  typ?: string
  wykluczenia?: number
  wykluczenia_scalone?: number
  reguly?: number
  receptury?: number
  receptury_kryteria?: number
  receptury_kolumny?: number
  receptury_nazwy?: string[]
  przypisania_magazynow?: number
  wymiary?: number
  zostawiono_stara?: boolean
  zlecenia_otwarte?: number
  zlecenia_wszystkie?: number
  zlecenia_archiwum?: number
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Ile wpisów (poza samym słownikiem) zmieni się przy zmianie nazwy. */
export function liczbaZmienianychWpisow(w: WynikZmianyNazwy): number {
  return n(w.wykluczenia) + n(w.reguly) + n(w.receptury_kryteria) + n(w.receptury_kolumny) +
    n(w.przypisania_magazynow) + n(w.wymiary)
}

function skrocNazwe(nazwa: string, max = 70): string {
  const t = nazwa.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Treść okna potwierdzenia (podgląd) — gdzie wartość jest użyta i ile wpisów się zmieni. */
export function opisZmianyNazwy(w: WynikZmianyNazwy): string {
  const stara = w.stara ?? ''
  const nowa = w.nowa ?? ''
  const zostaw = !!w.zostawiono_stara
  const linie: string[] = [`Zmiana nazwy: „${stara}" → „${nowa}"`, '']
  const zmiany: string[] = []
  if (n(w.wykluczenia) > 0) {
    zmiany.push(`• wykluczenia konfiguratora: ${n(w.wykluczenia)}` +
      (n(w.wykluczenia_scalone) > 0 ? ` (w tym ${n(w.wykluczenia_scalone)} zdublowanych — zostaną usunięte)` : ''))
  }
  if (n(w.receptury) > 0) {
    const nazwy = (w.receptury_nazwy ?? []).filter(Boolean).map((x) => skrocNazwe(String(x)))
    zmiany.push(`• receptury magazynu: ${n(w.receptury)}` +
      (nazwy.length ? ` (np. ${nazwy.join('; ')}${n(w.receptury) > nazwy.length ? '; …' : ''})` : ''))
  }
  if (n(w.reguly) > 0) zmiany.push(`• reguły Bastion: ${n(w.reguly)}`)
  if (n(w.przypisania_magazynow) > 0) zmiany.push(`• przypisania magazynów: ${n(w.przypisania_magazynow)}`)
  if (n(w.wymiary) > 0) zmiany.push(`• mapa wymiarów: ${n(w.wymiary)}`)
  if (zmiany.length) {
    linie.push(`Nowa nazwa trafi też do (${liczbaZmienianychWpisow(w)} wpisów):`, ...zmiany)
  } else {
    linie.push('Wartość nie jest użyta w wykluczeniach, recepturach ani regułach — zmieni się tylko słownik.')
  }
  const wszystkie = n(w.zlecenia_wszystkie) + n(w.zlecenia_archiwum)
  if (wszystkie > 0) {
    linie.push('',
      `Zamówienia ze starą nazwą: ${wszystkie} (otwarte: ${n(w.zlecenia_otwarte)}) — zostają bez zmian (historia, dopasowanie do Excela).`)
  }
  if (zostaw && (n(w.receptury) > 0 || n(w.przypisania_magazynow) > 0 || n(w.wymiary) > 0)) {
    linie.push(`W recepturach, przypisaniach magazynów i mapie wymiarów stara nazwa zostaje obok nowej, dopóki otwarte zlecenia jej używają.`)
  }
  if (n(w.reguly) > 0) {
    linie.push('W warunkach reguł Bastion stara nazwa zostaje obok nowej (bot i Excel mogą ją dalej przysyłać).')
  }
  linie.push('', 'Zmiana zostanie zapisana w historii zmian (audyt).')
  return linie.join('\n')
}

/** Krótki komunikat po udanej zmianie. */
export function podsumowanieZmianyNazwy(w: WynikZmianyNazwy): string {
  const ile = liczbaZmienianychWpisow(w)
  return ile > 0
    ? `Nazwa zmieniona na „${w.nowa ?? ''}" — przeniesiono do ${ile} wpisów (wykluczenia, receptury, reguły)`
    : `Nazwa zmieniona na „${w.nowa ?? ''}"`
}

/** Baza bez migracji 20261128055000 (funkcji nie ma) — aplikacja działa po staremu z blokadą używanych wartości. */
export function czyBrakFunkcjiZmianyNazwy(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code === 'PGRST202' || err.code === '42883') return true
  return /could not find the function/i.test(err.message ?? '')
}
