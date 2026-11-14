// =====================================================================
// Dostęp do danych modułu „CRM Po Drzwi” (schemat `crm`, brief 14.11.2026).
// Wszystko przez supabase.schema('crm') — PostgREST musi mieć schemat `crm`
// na liście Exposed schemas, inaczej dostajemy PGRST106 (crmErrorFrom tłumaczy
// to na komunikat dla admina). RLS: osoba bez dostępu widzi puste wyniki.
// Frontend TYLKO czyta i zmienia status oferty (wyslana / przelicz); logikę
// ofert (nowa wersja po poprawce, mail, cena) robi Edge Function drugiej sesji.
// =====================================================================
import { supabase } from '../supabaseClient'
import type { CrmLead, CrmOferta, CrmRozmowa, CrmZdarzenie } from '../types/crm'
import { CRM_OPEN_STATUSES } from '../types/crm'

const crm = () => supabase.schema('crm')

export type CrmError = { kind: 'schema_not_exposed' | 'no_access' | 'other'; message: string }

export function crmErrorFrom(e: { code?: string; message?: string } | null | undefined): CrmError | null {
  if (!e) return null
  const code = String(e.code ?? '')
  if (code === 'PGRST106') {
    return {
      kind: 'schema_not_exposed',
      message:
        'Schemat „crm” nie jest wystawiony w API Supabase. Administrator: panel Supabase → Project Settings → Data API → Exposed schemas → dopisać „crm”.',
    }
  }
  if (code === '42501') return { kind: 'no_access', message: 'Brak dostępu do danych CRM Po Drzwi.' }
  return { kind: 'other', message: e.message || 'Nieznany błąd' }
}

const LEAD_EMBED = 'lead:leady(id, nazwa, miejscowosc, telefon, email, kategoria, status)'
const OFERTA_LIST_COLS =
  'id, lead_id, rozmowa_id, wersja, poprzednia_id, status, produkt, cena_razem, koszyk_zgodny, sprawdz, mail_do, wyslano_at, created_at, updated_at'

type Result<T> = { data: T; error: CrmError | null }

export async function fetchOferty(onlyOpen: boolean): Promise<Result<CrmOferta[]>> {
  let q = crm()
    .from('oferty')
    .select(`${OFERTA_LIST_COLS}, ${LEAD_EMBED}`)
    .order('created_at', { ascending: false })
    .limit(300)
  if (onlyOpen) q = q.in('status', [...CRM_OPEN_STATUSES])
  const { data, error } = await q
  return { data: (data ?? []) as unknown as CrmOferta[], error: crmErrorFrom(error) }
}

export async function fetchOferta(id: string): Promise<Result<CrmOferta | null>> {
  const { data, error } = await crm().from('oferty').select('*, lead:leady(*)').eq('id', id).maybeSingle()
  return { data: (data ?? null) as unknown as CrmOferta | null, error: crmErrorFrom(error) }
}

/** Wszystkie wersje ofert leada (łańcuch poprzednia_id układamy po stronie widoku). */
export async function fetchOfertyLeada(leadId: string): Promise<Result<CrmOferta[]>> {
  const { data, error } = await crm()
    .from('oferty')
    .select(OFERTA_LIST_COLS)
    .eq('lead_id', leadId)
    .order('wersja', { ascending: true })
    .order('created_at', { ascending: true })
  return { data: (data ?? []) as unknown as CrmOferta[], error: crmErrorFrom(error) }
}

export async function fetchZdarzenia(filter: { ofertaId?: string; leadId?: string }): Promise<Result<CrmZdarzenie[]>> {
  let q = crm().from('zdarzenia').select('*').order('created_at', { ascending: true }).limit(500)
  if (filter.ofertaId) q = q.eq('oferta_id', filter.ofertaId)
  else if (filter.leadId) q = q.eq('lead_id', filter.leadId)
  const { data, error } = await q
  return { data: (data ?? []) as unknown as CrmZdarzenie[], error: crmErrorFrom(error) }
}

export async function fetchLead(id: string): Promise<Result<CrmLead | null>> {
  const { data, error } = await crm().from('leady').select('*').eq('id', id).maybeSingle()
  return { data: (data ?? null) as unknown as CrmLead | null, error: crmErrorFrom(error) }
}

export async function fetchRozmowy(leadId: string): Promise<Result<CrmRozmowa[]>> {
  const { data, error } = await crm()
    .from('rozmowy')
    .select('*')
    .eq('lead_id', leadId)
    .order('data_rozmowy', { ascending: false, nullsFirst: false })
  return { data: (data ?? []) as unknown as CrmRozmowa[], error: crmErrorFrom(error) }
}

/** „Wysłałam”: status=wyslana, wyslano_at=now(), sprawdzil=ja + zdarzenie `wyslano`. */
export async function markOfertaWyslana(oferta: CrmOferta, userId: string): Promise<CrmError | null> {
  const { error } = await crm()
    .from('oferty')
    .update({ status: 'wyslana', wyslano_at: new Date().toISOString(), sprawdzil: userId })
    .eq('id', oferta.id)
  if (error) return crmErrorFrom(error)
  const { error: zErr } = await crm().from('zdarzenia').insert({
    lead_id: oferta.lead_id,
    oferta_id: oferta.id,
    typ: 'wyslano',
    opis: `Mail do ${oferta.mail_do || 'klienta'} wysłany przez handlowca (skopiowany z aplikacji)`,
    kto: userId,
  })
  // zdarzenie to historia, nie blokujemy na nim — status już zmieniony
  if (zErr) console.warn('crm.zdarzenia wyslano:', zErr.message)
  return null
}

/** „Przelicz”: poprawka=tekst, status=przelicz. Nową wersję tworzy backend. */
export async function requestOfertaPrzelicz(oferta: CrmOferta, poprawka: string): Promise<CrmError | null> {
  const { error } = await crm().from('oferty').update({ poprawka, status: 'przelicz' }).eq('id', oferta.id)
  return crmErrorFrom(error)
}

/** Imiona do kolumny „kto” w historii (profiles, schemat public). */
export async function fetchProfileNames(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  const out = new Map<string, string>()
  if (uniq.length === 0) return out
  const { data } = await supabase.from('profiles').select('id, full_name, initials').in('id', uniq)
  for (const r of (data ?? []) as Array<{ id: string; full_name?: string | null; initials?: string | null }>) {
    out.set(r.id, (r.full_name || r.initials || '').trim() || r.id.slice(0, 8))
  }
  return out
}

// ---- Dostęp do CRM (crm.dostep) — tylko superadmin pisze (RLS) ----

export type CrmDostepRow = { user_id: string; nadal: string | null; nadano_at: string; uwagi: string | null }

export async function fetchCrmDostep(): Promise<Result<CrmDostepRow[]>> {
  const { data, error } = await crm().from('dostep').select('user_id, nadal, nadano_at, uwagi')
  return { data: (data ?? []) as unknown as CrmDostepRow[], error: crmErrorFrom(error) }
}

export async function grantCrmDostep(userId: string, grantedBy: string): Promise<CrmError | null> {
  const { error } = await crm().from('dostep').insert({ user_id: userId, nadal: grantedBy })
  return crmErrorFrom(error)
}

export async function revokeCrmDostep(userId: string): Promise<CrmError | null> {
  const { error } = await crm().from('dostep').delete().eq('user_id', userId)
  return crmErrorFrom(error)
}
