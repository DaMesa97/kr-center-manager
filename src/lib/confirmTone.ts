// Rodzaj okna potwierdzenia z jego treści (decyzja Tymka 23.10):
//  - 'danger'  — usuwanie, anulowanie, cofanie, „mimo to”… → fokus na „Anuluj”, Enter NIE potwierdza
//  - 'success' — pozytywne (wydanie, odebrane, zrealizowana, zweryfikowane…) → Enter potwierdza
const DANGER_RE =
  /usu[nń]|anulow|anuluj|cofn|cofa|dezaktyw|wyczy[sś]|zwolni|odrzu|skasuj|kasow|mimo to|nadpis|zast[aą]p/i

export function inferConfirmTone(...texts: Array<string | null | undefined>): 'danger' | 'success' {
  return texts.some((t) => DANGER_RE.test(String(t ?? ''))) ? 'danger' : 'success'
}
