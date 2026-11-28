-- 28.11.2026 — decyzja D14 (właściciel: TAK; zakres wg zadania: blokada PZ / MM na magazynie z otwartym spisem).
-- Problem: magazynier liczy rano, po południu PZ +10, wieczorem przepisuje kartkę → system_qty z chwili wpisania
-- zawiera dostawę, korekta INW ją zdejmuje.
-- Pojęcie „otwarty spis” już jest (inventory_sessions.status = 'open', jeden na magazyn). Sama otwarta sesja NIE
-- blokuje (sesje bywają otwarte długo jako dokument roboczy — 28.11 otwarta jest sesja 20 na WEW1 z 0 policzonych
-- pozycji; automatyczna blokada od razu zatrzymałaby tam przyjęcia). Zamiast tego:
--   * inventory_sessions.blokada_ruchow (domyślnie false) — kierownik / osoba z uprawnieniem „inwentaryzacja”
--     włącza ją na czas liczenia (aplikacja 1.1.8 proponuje to przy otwieraniu spisu i ma przełącznik przy sesji);
--   * ustaw_blokade_spisu(session, on/off) — uprawnienie 'ordering' (jak otwieranie spisu), tylko otwarta sesja;
--   * create_pz_document, receive_purchase_order (przyjęcie ZD) i create_mm_document (magazyn źródłowy LUB docelowy)
--     odmawiają (P0423) na magazynie z otwartym spisem z włączoną blokadą — komunikat mówi, który spis i co zrobić.
--   * zamknięcie spisu (status 'closed') kończy blokadę samo.
-- Zdjęć z etapów / wydań (WZ) NIE blokujemy — hala nie może stać (D41); ich wpływ zostaje jak dotąd.
-- Zależności: brak. Aplikacja 1.1.7 tej kolumny nie zna — działa jak dotąd (blokada nigdy się nie włącza).
-- DO WDROŻENIA (nie wgrane).

alter table public.inventory_sessions
  add column if not exists blokada_ruchow boolean not null default false,
  add column if not exists blokada_ustawiona_at timestamptz,
  add column if not exists blokada_ustawiona_by uuid;

create or replace function public.assert_magazyn_bez_blokady_spisu(p_warehouse_id bigint)
 returns void
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_s record;
begin
  if p_warehouse_id is null then return; end if;
  select s.id, s.counted_date, w.code, w.name into v_s
  from inventory_sessions s
  join warehouses w on w.id = s.warehouse_id
  where s.status = 'open' and s.blokada_ruchow and s.warehouse_id = p_warehouse_id
  order by s.id desc limit 1;
  if found then
    raise exception 'Na magazynie % trwa spis (sesja #%, liczenie %) — przyjęcia (PZ) i przesunięcia (MM) są wstrzymane do zamknięcia spisu. Zamknij spis albo zdejmij blokadę w zakładce Inwentaryzacja.',
      coalesce(nullif(v_s.name, ''), v_s.code), v_s.id, to_char(v_s.counted_date, 'DD.MM.YYYY')
      using errcode = 'P0423';
  end if;
end;
$function$;

revoke all on function public.assert_magazyn_bez_blokady_spisu(bigint) from public, anon, authenticated;

create or replace function public.ustaw_blokade_spisu(p_session_id integer, p_blokada boolean)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text;
begin
  perform public.assert_warehouse_perm('ordering');
  select status into v_status from inventory_sessions where id = p_session_id for update;
  if not found then raise exception 'Sesja inwentaryzacyjna % nie istnieje', p_session_id; end if;
  if v_status <> 'open' and coalesce(p_blokada, false) then
    raise exception 'Sesja inwentaryzacyjna jest zamknięta — blokady nie da się włączyć';
  end if;
  update inventory_sessions
     set blokada_ruchow = coalesce(p_blokada, false),
         blokada_ustawiona_at = now(),
         blokada_ustawiona_by = auth.uid()
   where id = p_session_id;
  return coalesce(p_blokada, false);
end;
$function$;

revoke all on function public.ustaw_blokade_spisu(integer, boolean) from public, anon;
grant execute on function public.ustaw_blokade_spisu(integer, boolean) to authenticated, service_role;

create or replace function public.create_pz_document(p_warehouse_id bigint, p_items jsonb, p_reference_doc text, p_notes text)
 returns table(r_component_id bigint, r_component_name text, r_quantity numeric, r_revalidated_orders integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public.assert_warehouse_perm('movements');
  perform public.assert_magazyn_bez_blokady_spisu(p_warehouse_id);  -- D14
  return query select * from public.create_pz_document__impl(p_warehouse_id, p_items, p_reference_doc, p_notes);
end; $function$;

create or replace function public.create_mm_document(p_warehouse_from_id bigint, p_warehouse_to_id bigint, p_items jsonb, p_reference_doc text, p_notes text)
 returns table(r_component_id bigint, r_component_name text, r_quantity numeric, r_from_warehouse_code text, r_to_warehouse_code text, r_revalidated_orders integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public.assert_warehouse_perm('movements');
  perform public.assert_magazyn_bez_blokady_spisu(p_warehouse_from_id);  -- D14
  perform public.assert_magazyn_bez_blokady_spisu(p_warehouse_to_id);
  return query select * from public.create_mm_document__impl(p_warehouse_from_id, p_warehouse_to_id, p_items, p_reference_doc, p_notes);
end; $function$;

create or replace function public.receive_purchase_order(p_po_id bigint, p_warehouse_id bigint, p_received_items jsonb, p_reference_doc text default null::text, p_notes text default null::text, p_allow_over boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public.assert_warehouse_perm('movements');
  perform public.assert_magazyn_bez_blokady_spisu(p_warehouse_id);  -- D14
  perform public.receive_purchase_order__impl(p_po_id, p_warehouse_id, p_received_items, p_reference_doc, p_notes, p_allow_over);
end;
$function$;
