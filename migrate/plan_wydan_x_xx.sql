-- ============================================================================
-- Plan wydań X/XX — zastępuje Airtable brygadzisty (wdrożone przez MCP jako
-- migracja plan_wydan_x_xx, 2026-10-21)
--
-- Konwencja 1:1 z arkuszem: extra_fields.route_mark = 'XX' (towar na magazyn
-- DZIŚ) albo 'X' (na JUTRO). Brygadzista klika w kolumnie X/XX w Wysyłce
-- (puste → X → XX → puste; zapis przez merge_order_extra_fields).
--
-- Włączenie webhooka do Make (po utworzeniu scenariusza):
--   insert into app_config (key, value) values ('route_plan_webhook_url',
--     'https://hook.eu2.make.com/XXXX') on conflict (key) do update
--     set value = excluded.value, updated_at = now();
-- Brak klucza = webhook pomijany (dzwonek w apce i tak idzie).
-- ============================================================================

create extension if not exists pg_net;

create or replace function public.get_route_plan()
returns table(
  r_mark text, r_order_number text, r_category text, r_company text,
  r_model text, r_quantity numeric, r_route_day text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select o.extra_fields->>'route_mark',
         o.order_number, o.category, o.company, o.model,
         coalesce(o.quantity, 1)::numeric,
         coalesce(c.route_day, '')
  from orders o
  left join companies c on lower(trim(c.name)) = lower(trim(o.company))
  where o.release_date is null
    and coalesce(o.extra_fields->>'cancelled', 'false') <> 'true'
    and o.extra_fields->>'route_mark' in ('X', 'XX')
  order by o.extra_fields->>'route_mark' desc, coalesce(c.route_day, ''), o.order_number;
$$;

revoke all on function public.get_route_plan() from public, anon;
grant execute on function public.get_route_plan() to authenticated, service_role;

create or replace function public.send_route_plan_summary()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_xx int;
  v_x int;
  v_url text;
begin
  select count(*) filter (where extra_fields->>'route_mark' = 'XX'),
         count(*) filter (where extra_fields->>'route_mark' = 'X')
  into v_xx, v_x
  from orders
  where release_date is null
    and coalesce(extra_fields->>'cancelled', 'false') <> 'true'
    and extra_fields->>'route_mark' in ('X', 'XX');

  if coalesce(v_xx, 0) = 0 and coalesce(v_x, 0) = 0 then
    return; -- pusty plan = cisza, nie spamujemy
  end if;

  insert into notifications (user_id, type, title, body, link_tab)
  select p.id, 'route_plan', 'Plan wydań',
         'Na dziś (XX): ' || coalesce(v_xx, 0) || ' zleceń · na jutro (X): '
           || coalesce(v_x, 0) || '. Szczegóły: Wysyłka, filtr Plan wydań.',
         'Wysyłka'
  from profiles p
  where p.role in ('kierownik_magazynu', 'kierownik_firmowy', 'admin');

  select value into v_url from app_config where key = 'route_plan_webhook_url';
  if v_url is not null and trim(v_url) <> '' then
    perform net.http_post(
      url := v_url,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'xx_na_dzis', coalesce(v_xx, 0),
        'x_na_jutro', coalesce(v_x, 0),
        'zlecenia', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'mark', r_mark, 'nr', r_order_number, 'kategoria', r_category,
            'firma', r_company, 'model', r_model, 'ilosc', r_quantity,
            'trasa', r_route_day
          )), '[]'::jsonb)
          from get_route_plan()
        )
      )
    );
  end if;
end;
$$;

revoke all on function public.send_route_plan_summary() from public, anon, authenticated;

select cron.schedule(
  'route-plan-summary-daily',
  '0 13 * * 1-5',
  $$select public.send_route_plan_summary()$$
);
