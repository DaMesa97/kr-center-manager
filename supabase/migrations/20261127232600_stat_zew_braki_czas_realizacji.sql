-- 27.11.2026 (testy 27.11, runda 3; CEO/statystyki): stat_zew_braki liczył średni czas realizacji
-- (sr_realizacja dla komponentu i v_kat = sr_realizacja_kat dla kategorii) także z:
--   * zleceń ze złą kolejnością dat (release_date < order_date) — ujemne czasy zaniżały/psuły średnią
--     (27.11: Disting 2, STA 3 takie zlecenia);
--   * zleceń z datą wydania wpisaną „na oko” przez excel-sync (extra_fields.release_date_szacunkowa = true,
--     wszystkie 2026-11-06; ST 1046 z 1047 wydanych, Bastion 3220 z 3271, Disting 605) — fałszywe czasy.
-- Teraz oba czasy liczone tylko z wydań z prawdziwą datą i release_date >= order_date. Liczniki (zlecenia, wydania,
-- brak_szt) bez zmian — dotyczą wydań WZ, nie dat. Gdy brak wiarygodnych dat, czas = NULL (nie 0).
-- DO WDROŻENIA (nie wgrane w sesji).
create or replace function public.stat_zew_braki(p_category text, p_days integer default 90)
 returns table(component_id bigint, kod text, nazwa text, kategoria text, zlecenia bigint, wydania bigint, brak_szt numeric, pierwsze date, ostatnie date, sr_realizacja numeric, sr_realizacja_kat numeric, stan numeric, rezerwacje numeric, dostepne numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_od timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 90), 1));
  -- testy 27.11 (runda 3): tylko prawdziwe daty wydania i poprawna kolejność dat
  v_kat numeric := (
    select round(avg(o.release_date - o.order_date), 1) from public.orders o
    where o.category = p_category and o.release_date is not null and o.order_date >= v_od::date
      and o.release_date >= o.order_date
      and coalesce(o.extra_fields->>'release_date_szacunkowa', '') <> 'true'
      and coalesce(o.extra_fields->>'cancelled', '') <> 'true');
begin
  if not public.current_user_is_manager() then return; end if;
  return query
    with w as (
      select m.component_id, m.order_id, m.created_at,
             (regexp_match(coalesce(m.notes, ''), '\[WYMUSZONE brak ([0-9]+(?:[.,][0-9]+)?)\]'))[1] as brak_txt,
             case when o.release_date >= o.order_date
                   and coalesce(o.extra_fields->>'release_date_szacunkowa', '') <> 'true'
                  then o.release_date - o.order_date end as dni
      from public.warehouse_movements m
      join public.orders o on o.id = m.order_id
      where m.movement_type = 'WZ' and m.notes ilike '%WYMUSZONE%' and m.created_at >= v_od
        and o.category = p_category
    )
    select w.component_id, c.code, c.name, c.category,
           count(distinct w.order_id)::bigint, count(*)::bigint,
           sum(replace(coalesce(w.brak_txt, '0'), ',', '.')::numeric),
           min(w.created_at)::date, max(w.created_at)::date,
           round(avg(w.dni), 1), v_kat,
           s.stan, s.rez, s.dost
    from w
    join public.warehouse_components c on c.id = w.component_id
    left join lateral (
      select sum(v.quantity) as stan, sum(v.reserved_quantity) as rez, sum(v.available_quantity) as dost
      from public.v_stock_levels v where v.component_id = w.component_id
    ) s on true
    group by w.component_id, c.code, c.name, c.category, s.stan, s.rez, s.dost;
end;
$function$;
