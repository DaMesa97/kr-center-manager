-- 28.11.2026 — decyzja D41 (właściciel: TAK, wariant a): gdy zdjęcie z magazynu przy etapie / wydaniu się nie uda,
-- etap (data wydania) i tak się zapisuje — hala nie stoi — a zlecenie trafia na listę „Magazyn do sprawdzenia”
-- w Weryfikacji. Dotąd błąd dawał tylko toast „Ostrzeżenie” (a wyjątek sieci — nic), rezerwacje zostawały bez śladu.
-- Nie używamy orders.stock_status (przelicza go recompute_order_stock_status — znacznik by znikał) ani
-- get_orders_needing_review (to weryfikacja zleceń z bota: needs_review, „Zatwierdź”) — osobna tabela z historią.
--   * stock_release_failures — jeden wiersz na nieudane zdjęcie (zlecenie + etap / wydanie końcowe / drzwi wewn.);
--     otwarty = resolved_at is null. RLS włączone, bez polityk: dostęp tylko przez funkcje poniżej.
--   * zglos_blad_zdjecia_magazynu(order, kind, stage_key, error, source) — woła aplikacja PO udanym zapisie etapu
--     (każdy zalogowany, który mógł oznaczyć etap). Otwarty wpis na to samo zlecenie + etap → aktualizacja treści
--     błędu (bez dubli przy ponownym kliknięciu).
--   * lista_bledow_zdjecia_magazynu() — otwarte wpisy z numerem zlecenia (kierownik / uprawnienie „ruchy”).
--   * rozwiaz_blad_zdjecia_magazynu(id, retry) — retry = true: ponowienie zdjęcia z force (etap →
--     release_stock_for_stage, wydanie → release_remaining_for_order, drzwi wewn. → issue_internal_door_stock),
--     błąd = wpis zostaje otwarty; retry = false: „sprawdzone ręcznie” (np. korekta zrobiona inaczej).
--     Wymaga uprawnienia „ruchy magazynowe” (jak samo zdjęcie).
-- Aplikacja (od 1.1.8) przy braku tych funkcji (PGRST202) mówi „zgłoś kierownikowi” jak dotąd, a sekcja
-- w Weryfikacji się nie pokazuje.
-- Zależności: brak.
-- DO WDROŻENIA (nie wgrane).

create table if not exists public.stock_release_failures (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  kind text not null default 'etap' check (kind in ('etap', 'wydanie', 'drzwi_wew')),
  stage_key text,
  error_message text,
  source text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text check (resolution is null or resolution in ('ponowiono', 'sprawdzone'))
);

create index if not exists stock_release_failures_open_idx
  on public.stock_release_failures (order_id) where resolved_at is null;

alter table public.stock_release_failures enable row level security;
revoke all on table public.stock_release_failures from public, anon, authenticated;
grant all on table public.stock_release_failures to service_role;
revoke all on sequence public.stock_release_failures_id_seq from public, anon, authenticated;

create or replace function public.zglos_blad_zdjecia_magazynu(
  p_order_id bigint, p_kind text, p_stage_key text, p_error text, p_source text default null
)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id bigint;
  v_kind text := coalesce(nullif(trim(p_kind), ''), 'etap');
  v_stage text := nullif(trim(coalesce(p_stage_key, '')), '');
  v_err text := left(coalesce(p_error, ''), 500);
begin
  -- D41: zgłoszenie po udanym zapisie etapu; każdy zalogowany (etap oznacza hala)
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Brak zalogowanego użytkownika';
  end if;
  if v_kind not in ('etap', 'wydanie', 'drzwi_wew') then
    raise exception 'Nieznany rodzaj zdjęcia z magazynu: %', v_kind;
  end if;
  if v_kind = 'etap' and v_stage is null then
    raise exception 'Brak etapu dla zgłoszenia';
  end if;
  if not exists (select 1 from orders where id = p_order_id) then
    raise exception 'Zlecenie % nie istnieje', p_order_id;
  end if;

  select id into v_id from stock_release_failures
  where order_id = p_order_id and kind = v_kind and coalesce(stage_key, '') = coalesce(v_stage, '')
    and resolved_at is null
  order by id desc limit 1
  for update;

  if found then
    update stock_release_failures
       set error_message = v_err, source = coalesce(p_source, source), updated_at = now()
     where id = v_id;
    return v_id;
  end if;

  insert into stock_release_failures (order_id, kind, stage_key, error_message, source)
  values (p_order_id, v_kind, v_stage, v_err, p_source)
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.lista_bledow_zdjecia_magazynu()
 returns table(r_id bigint, r_order_id bigint, r_order_number text, r_category text, r_company text,
               r_kind text, r_stage_key text, r_error text, r_source text, r_created_at timestamptz,
               r_updated_at timestamptz, r_created_by_name text, r_release_date date)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_manager() or public.current_user_can_warehouse('movements')) then
    raise exception 'Brak uprawnień do listy błędów magazynu';
  end if;
  return query
  select f.id, f.order_id, o.order_number::text, o.category::text, o.company::text,
         f.kind, f.stage_key, f.error_message, f.source, f.created_at, f.updated_at,
         (select coalesce(nullif(trim(p.full_name), ''), p.initials) from profiles p where p.id = f.created_by)::text,
         o.release_date::date
  from stock_release_failures f
  join orders o on o.id = f.order_id
  where f.resolved_at is null
  order by f.created_at;
end;
$function$;

create or replace function public.rozwiaz_blad_zdjecia_magazynu(p_id bigint, p_retry boolean default true)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_f record;
  v_released int := 0;
  v_shortage int := 0;
begin
  perform public.assert_warehouse_perm('movements');
  select * into v_f from stock_release_failures where id = p_id for update;
  if not found then raise exception 'Wpis % nie istnieje', p_id; end if;
  if v_f.resolved_at is not null then
    return jsonb_build_object('status', 'juz_rozwiazane');
  end if;

  if p_retry then
    if v_f.kind = 'etap' then
      select count(*) filter (where x.r_status = 'released'), count(*) filter (where x.r_status = 'released' and x.r_shortage > 0)
        into v_released, v_shortage
      from public.release_stock_for_stage(v_f.order_id, v_f.stage_key, true) x;
    elsif v_f.kind = 'wydanie' then
      select count(*) filter (where x.r_status = 'released'), count(*) filter (where x.r_status = 'released' and x.r_shortage > 0)
        into v_released, v_shortage
      from public.release_remaining_for_order(v_f.order_id, true) x;
    else
      select count(*) into v_released from public.issue_internal_door_stock(v_f.order_id) x;
    end if;
  end if;

  update stock_release_failures
     set resolved_at = now(), resolved_by = auth.uid(),
         resolution = case when p_retry then 'ponowiono' else 'sprawdzone' end, updated_at = now()
   where id = p_id;

  return jsonb_build_object('status', case when p_retry then 'ponowiono' else 'sprawdzone' end,
                            'wydano_pozycji', v_released, 'mimo_braku', v_shortage);
end;
$function$;

revoke all on function public.zglos_blad_zdjecia_magazynu(bigint, text, text, text, text) from public, anon;
revoke all on function public.lista_bledow_zdjecia_magazynu() from public, anon;
revoke all on function public.rozwiaz_blad_zdjecia_magazynu(bigint, boolean) from public, anon;
grant execute on function public.zglos_blad_zdjecia_magazynu(bigint, text, text, text, text) to authenticated, service_role;
grant execute on function public.lista_bledow_zdjecia_magazynu() to authenticated, service_role;
grant execute on function public.rozwiaz_blad_zdjecia_magazynu(bigint, boolean) to authenticated, service_role;
