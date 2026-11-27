-- 27.11.2026 (testy 27.11, runda 3; WYSOKI): anulowane zlecenie dało się wydać i wysłać.
--  a) issue_internal_door_stock — odmowa (P0410), gdy zlecenie drzwi wewnętrznych jest anulowane
--     (extra_fields.cancelled = true). Anulowanie w aplikacji oddaje towar przez return_stock_for_order, nie przez
--     tę funkcję, więc nic legalnego jej po anulowaniu nie woła. Od poprawki z próby generalnej blokada jest
--     w treści funkcji w 20261127233200 — tu tylko kontrola „już jest” (łata, gdy 233200 nie wgrano).
--  b) trigger BEFORE UPDATE OF release_date na orders: data wydania (z pustej na wartość) dla anulowanego zlecenia
--     jest odrzucana (P0410) — tylko dla zalogowanego użytkownika (auth.uid() is not null; także gdy woła funkcję
--     SECURITY DEFINER, np. oznacz_wydane_wysylki). Sprawdzone 27.11: żadna funkcja ani import nie ustawia daty na
--     anulowanym celowo — sync_releases_from_excel (także grupa TITAN) pomija anulowane, oznacz_wydane_wysylki
--     dotyczy listy „Do wysyłki” (bez anulowanych), orders-intake / orders-excel-intake wstawiają null,
--     sync_complaints_from_excel zmienia complaints, nie orders. Konto serwisowe i postgres (porządki,
--     migracje) przechodzą bez zmian. Zmiana / wyczyszczenie istniejącej daty — bez zmian.
--  c) zlec_przesylke_bl — odmowa (P0410) przed jakąkolwiek zmianą i przed net.http_post do BaseLinkera, gdy któreś
--     zlecenie przypięte do wysyłki jest anulowane.
-- Zlecenie testowe anulowania: id 29362.
-- DO WDROŻENIA (nie wgrane w sesji).

-- a) wydanie z magazynu wewnętrznego
do $$
declare
  d text;
  stare text := '  perform 1 from orders where id = p_order_id for update;';
  nowe text := '  perform 1 from orders where id = p_order_id for update;
  -- anulowanego zlecenia nie wydajemy (testy 27.11, runda 3)
  if exists (select 1 from orders where id = p_order_id and extra_fields->>''cancelled'' = ''true'') then
    raise exception ''Zlecenie jest anulowane — nie można wydać towaru z magazynu. Najpierw przywróć zlecenie.''
      using errcode = ''P0410'';
  end if;';
begin
  d := pg_get_functiondef('public.issue_internal_door_stock(bigint)'::regprocedure);
  if position('P0410' in d) > 0 then
    raise notice 'issue_internal_door_stock: już poprawione — bez zmian';
    return;
  end if;
  if position(stare in d) = 0 then
    raise exception 'issue_internal_door_stock: nie znaleziono miejsca łatki — sprawdź definicję';
  end if;
  execute replace(d, stare, nowe);
end $$;

-- b) data wydania na anulowanym zleceniu
create or replace function public.orders_block_release_cancelled()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- testy 27.11 (runda 3): użytkownik nie oznaczy anulowanego zlecenia jako wydane
  if auth.uid() is not null then
    raise exception 'Zlecenie jest anulowane — nie można ustawić daty wydania. Najpierw przywróć zlecenie.'
      using errcode = 'P0410';
  end if;
  return new;
end;
$function$;

revoke all on function public.orders_block_release_cancelled() from public, anon, authenticated;

drop trigger if exists trg_orders_block_release_cancelled on public.orders;
create trigger trg_orders_block_release_cancelled
  before update of release_date on public.orders
  for each row
  when (old.release_date is null and new.release_date is not null and (new.extra_fields->>'cancelled') = 'true')
  execute function public.orders_block_release_cancelled();

-- c) przesyłka BaseLinker dla wysyłki z anulowanym zleceniem
do $$
declare
  d text;
  stare text := '  if v_s.status = ''anulowana'' then raise exception ''Wysyłka jest anulowana''; end if;';
  nowe text := '  if v_s.status = ''anulowana'' then raise exception ''Wysyłka jest anulowana''; end if;
  -- testy 27.11 (runda 3): anulowane zlecenie nie jedzie — odmowa przed zmianą statusu i wywołaniem BaseLinkera
  if exists (select 1 from order_shipment_orders so join orders o on o.id = so.order_id
             where so.shipment_id = p_shipment_id and o.extra_fields->>''cancelled'' = ''true'') then
    raise exception ''Nie można zlecić przesyłki — w wysyłce jest anulowane zlecenie: %. Odepnij je albo przywróć zlecenie.'',
      (select string_agg(coalesce(o.category, '''') || '' '' || coalesce(o.order_number, o.id::text), '', '')
       from order_shipment_orders so join orders o on o.id = so.order_id
       where so.shipment_id = p_shipment_id and o.extra_fields->>''cancelled'' = ''true'')
      using errcode = ''P0410'';
  end if;';
begin
  d := pg_get_functiondef('public.zlec_przesylke_bl(bigint)'::regprocedure);
  if position('P0410' in d) > 0 then
    raise notice 'zlec_przesylke_bl: już poprawione — bez zmian';
    return;
  end if;
  if position(stare in d) = 0 then
    raise exception 'zlec_przesylke_bl: nie znaleziono miejsca łatki — sprawdź definicję';
  end if;
  execute replace(d, stare, nowe);
end $$;
