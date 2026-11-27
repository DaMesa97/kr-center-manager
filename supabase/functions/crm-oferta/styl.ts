// Styl maila handlowca dla maili z ofertą (zgłoszenie #159, 18.11: „mail oferty generuje się z automatu w imieniu Magdy, a przy zadaniu
// mogę wygenerować mail w tonie handlowca”). Ta sama logika co w crm-szkic (próbki = maile wysłane ze skrzynki z user_id handlowca,
// a gdy ich nie ma – ze wspólnej skrzynki kontakt@). Kopia w crm-oferta/styl.ts i crm-oferta-pdf/styl.ts (funkcje Edge nie dzielą plików):
// zmieniasz tu = zmień tam (i w crm-szkic). Ten plik nie importuje niczego w czasie wykonania (tylko typ), więc testy Node go czytają.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export type Probka = { temat: string; tresc: string }
export type Styl = {
  handlowiec_id: string | null; imie: string; podpis: string
  probki: Probka[]; probki_zrodlo: 'wlasna' | 'wspolna' | null
}

/** Styl dla oferty: handlowiec podany (oferta.handlowiec / zalogowany) → ostatnia osoba piszącą do klienta → ustawienie szkic_domyslny_handlowiec. */
export async function stylHandlowca(db: SupabaseClient, handlowiecId: string | null, leadId: string | null): Promise<Styl> {
  const id = handlowiecId ?? (leadId ? await ostatniPiszacy(db, leadId) : null) ?? (await domyslnyHandlowiec(db))
  const [imie, pr, ust] = await Promise.all([imieHandlowca(db, id), probkiStylu(db, id), ustawieniaFirmy(db)])
  const podpis = `${imie}\nPo Drzwi\ntel. ${ust.firma_tel ?? '+48 504 800 103'}\n${ust.firma_email ?? 'kontakt@podrzwi.pl'}`
  return { handlowiec_id: id, imie, podpis, probki: pr.probki, probki_zrodlo: pr.zrodlo }
}

/** Akapit do promptu systemowego: jak pisać i jak się podpisać. */
export function blokStyluSystem(s: Styl): string {
  return s.probki.length
    ? `STYL: w danych jest ${s.probki.length} maili, które ${s.imie} naprawdę wysłał(a) do klientów. Pisz tak, jak ta osoba: to samo powitanie `
      + 'i pożegnanie, podobna długość zdań i akapitów, te same zwroty, ten sam poziom bezpośredniości i ciepła. Nie kopiuj treści próbek, '
      + 'tylko sposób pisania; jeśli próbki się różnią, trzymaj się najnowszych. PODPIS: przepisz dokładnie podpis z próbek (bez zmian).'
    : `STYL: nie ma jeszcze próbek maili tej osoby; pisz ciepło i konkretnie, krótkie akapity, bez korporacyjnego żargonu. PODPIS: kończysz dokładnie tym podpisem:\n${s.podpis}`
}

/** Próbki do promptu użytkownika (pusty tekst, gdy brak). */
export function blokStyluUser(s: Styl): string {
  if (!s.probki.length) return ''
  let t = `\n\nPRÓBKI STYLU (maile wysłane przez ${s.imie} do innych klientów; wzór sposobu pisania i podpisu, NIE treści):\n`
  s.probki.forEach((p, i) => { t += `--- Próbka ${i + 1}${p.temat ? ` (temat: ${p.temat})` : ''}\n${p.tresc}\n` })
  return t + '--- koniec próbek'
}

/** Wartość kolumny oferty.mail_styl. */
export function stylDoZapisu(s: Styl, auto: boolean) {
  return { handlowiec_id: s.handlowiec_id, handlowiec: s.imie, probki: s.probki.length, probki_zrodlo: s.probki_zrodlo, auto, utworzono: new Date().toISOString() }
}

// --------------------------------------------------------------------------------------------
async function probkiStylu(db: SupabaseClient, handlowiecId: string | null): Promise<{ probki: Probka[]; zrodlo: 'wlasna' | 'wspolna' | null }> {
  const { data: skrz } = await db.from('skrzynki').select('id, user_id')
  const wlasne = (skrz ?? []).filter((s: { user_id: string | null }) => handlowiecId && s.user_id === handlowiecId).map((s: { id: string }) => s.id)
  const wspolne = (skrz ?? []).filter((s: { user_id: string | null }) => !s.user_id).map((s: { id: string }) => s.id)
  const pobierz = async (ids: string[]) => {
    if (!ids.length) return []
    const { data } = await db.from('maile').select('temat, tresc, data').eq('kierunek', 'wychodzacy').in('skrzynka_id', ids)
      .not('tresc', 'is', null).order('data', { ascending: false }).limit(40)
    return (data ?? []) as { temat: string | null; tresc: string | null }[]
  }
  let lista = await pobierz(wlasne)
  let zrodlo: 'wlasna' | 'wspolna' | null = lista.length ? 'wlasna' : null
  if (!lista.length) { lista = await pobierz(wspolne); zrodlo = lista.length ? 'wspolna' : null }
  const probki = lista
    .map((m) => ({ temat: (m.temat ?? '').trim(), tresc: usunCytat(m.tresc ?? '') }))
    .filter((m) => m.tresc.length >= 120 && m.tresc.length <= 6000 && !/^(fwd?|pd|przes)\s*:/i.test(m.temat) && !/\[po drzwi\]/i.test(m.temat))
    .slice(0, 6)
    .map((m) => ({ temat: m.temat, tresc: m.tresc.slice(0, 1800) }))
  return { probki, zrodlo: probki.length ? zrodlo : null }
}

async function ostatniPiszacy(db: SupabaseClient, leadId: string): Promise<string | null> {
  const { data } = await db.from('maile').select('skrzynka_id').eq('lead_id', leadId).eq('kierunek', 'wychodzacy').not('skrzynka_id', 'is', null)
    .order('data', { ascending: false }).limit(5)
  for (const m of (data ?? []) as { skrzynka_id: string }[]) {
    const { data: s } = await db.from('skrzynki').select('user_id').eq('id', m.skrzynka_id).maybeSingle()
    if (s?.user_id) return s.user_id
  }
  return null
}

async function domyslnyHandlowiec(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from('ustawienia').select('wartosc').eq('klucz', 'szkic_domyslny_handlowiec').maybeSingle()
  const v = (data?.wartosc ?? '').trim()
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null
}

async function imieHandlowca(db: SupabaseClient, id: string | null): Promise<string> {
  if (id) {
    const { data } = await db.schema('public').from('profiles').select('full_name').eq('id', id).maybeSingle()
    const imie = (data?.full_name ?? '').trim().split(/\s+/)[0]
    if (imie) return imie
  }
  return 'Magdalena'
}

async function ustawieniaFirmy(db: SupabaseClient): Promise<Record<string, string | null>> {
  const { data } = await db.from('ustawienia').select('klucz, wartosc').in('klucz', ['firma_tel', 'firma_email'])
  const out: Record<string, string | null> = {}
  for (const r of (data ?? []) as { klucz: string; wartosc: string | null }[]) out[r.klucz] = r.wartosc
  return out
}

/** Odcina cytowaną historię (linie „> ”, „W dniu … napisał”, „-----Original Message-----”, „Od: …”). */
function usunCytat(t: string): string {
  const s = String(t ?? '').replace(/\r/g, '')
  const m = s.match(/\n\s*(>|W dniu .{0,120}(napisa|pisze)|Dnia .{0,120}napisa|On .{0,120}wrote:|-{3,}\s*Original Message|From:\s|Od:\s.*\n(Wysłano|Sent|Do|To):)/i)
  return (m && m.index != null && m.index > 40 ? s.slice(0, m.index) : s)
    // opisy obrazków ze stopki HTML (u Magdy w każdym mailu: „Stopka mailowa – Po Drzwi (wersja na obrazkach)”) trafiały do podpisu (18.11)
    .replace(/^[^\n]*\(wersja na obrazkach\)[^\n]*\n?/gim, '').replace(/^\s*\[(image|cid|obraz)[^\]\n]*\]\s*$/gim, '')
    .trim()
}
