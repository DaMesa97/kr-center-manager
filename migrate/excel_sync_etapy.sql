-- 2026-11-24: Etapy produkcji z Excela → program (Tymek: „śledzimy realizację zleceń na koniec dnia,
-- dałoby się też śledzić etapy Excel > Program?”).
--
-- Ten sam nocny przebieg excel-sync (Make → edge function) czyta dodatkowo kolumny etapów z arkuszy
-- zamówień (inicjały pracowników) i po dopasowaniu wierszy do zleceń (to samo dopasowanie, co wydania:
-- sync_releases_from_excel → items) woła poniższy RPC. Zasada: program ma pierwszeństwo — uzupełniamy
-- TYLKO puste etapy w programie, niczego nie nadpisujemy i nie kasujemy. Wartości z Excela:
--   inicjały (1–3 litery) → inicjały; X / XX → '#ND' (nie dotyczy, zwalnia rezerwacje etapu jak w aplikacji);
--   WSTRZYMANE → '#WS:Excel'; '-' / puste → pomijane; reszta (2P, P/Z, NIE FREZOWAĆ, BRAK OŚC, NA STOJAKU, daty)
--   → lista „nietypowe” w raporcie, bez zapisu.
-- Wynik ląduje w tym samym wierszu excel_sync_runs co wydania (summary.etapy, etapy_zmiany, etapy_rozne,
-- etapy_nietypowe), więc widok w aplikacji nie dostaje nowej kategorii.
-- Tryb: integration_settings.excel_sync_etapy = 'off' | 'dry' (podgląd, bez zapisu) | 'on'. Start w 'dry'.

insert into public.integration_settings (key, value)
values ('excel_sync_etapy', 'dry')
on conflict (key) do nothing;

create or replace function public.sync_stages_from_excel(
  p_items jsonb,
  p_dry_run boolean default true,
  p_run_id bigint default null,
  p_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $$
declare
  it record;
  st record;
  v_cur jsonb;
  v_old text;
  v_new text;
  v_changed boolean;
  v_zlecen int := 0;
  v_uzup int := 0;
  v_zgodne int := 0;
  v_rozne int := 0;
  v_nietyp int := 0;
  v_zmiany jsonb := '[]'::jsonb;
  v_rozne_lista jsonb := '[]'::jsonb;
  v_nietyp_lista jsonb := '[]'::jsonb;
  v_summary jsonb;
begin
  perform assert_manager_or_service();

  for it in
    select (e->>'id')::bigint as id, e->>'order_number' as nr, e->>'excel_row' as excel_row,
           coalesce(e->'stages', '{}'::jsonb) as stages, coalesce(e->'nietypowe', '[]'::jsonb) as nietyp
    from jsonb_array_elements(p_items) e
    where (e->>'id') is not null
  loop
    select production_stages into v_cur
    from orders
    where id = it.id and coalesce(extra_fields->>'cancelled', '') <> 'true'
    for update;
    if not found then continue; end if;
    v_zlecen := v_zlecen + 1;
    v_cur := coalesce(v_cur, '{}'::jsonb);
    v_changed := false;

    -- nietypowe wartości z Excela: tylko do raportu
    if jsonb_array_length(it.nietyp) > 0 then
      v_nietyp := v_nietyp + jsonb_array_length(it.nietyp);
      if jsonb_array_length(v_nietyp_lista) < 100 then
        v_nietyp_lista := v_nietyp_lista || (
          select coalesce(jsonb_agg(jsonb_build_object('id', it.id, 'nr', it.nr, 'wiersz', it.excel_row, 'etap', n->>'etap', 'excel', n->>'wartosc')), '[]'::jsonb)
          from jsonb_array_elements(it.nietyp) n
        );
      end if;
    end if;

    for st in select key, value from jsonb_each_text(it.stages) loop
      v_new := trim(coalesce(st.value, ''));
      if v_new = '' then continue; end if;
      v_old := coalesce(trim(v_cur->>st.key), '');
      if v_old = '' then
        v_uzup := v_uzup + 1;
        if jsonb_array_length(v_zmiany) < 300 then
          v_zmiany := v_zmiany || jsonb_build_object('id', it.id, 'nr', it.nr, 'wiersz', it.excel_row, 'etap', st.key, 'na', v_new);
        end if;
        if not p_dry_run then
          v_cur := v_cur || jsonb_build_object(st.key, v_new);
          v_changed := true;
          if upper(v_new) = '#ND' then
            perform public.cancel_stage_reservations__impl(it.id, st.key);
          end if;
        end if;
      elsif upper(v_old) = upper(v_new) then
        v_zgodne := v_zgodne + 1;
      else
        v_rozne := v_rozne + 1;
        if jsonb_array_length(v_rozne_lista) < 100 then
          v_rozne_lista := v_rozne_lista || jsonb_build_object('id', it.id, 'nr', it.nr, 'wiersz', it.excel_row, 'etap', st.key, 'program', v_old, 'excel', v_new);
        end if;
      end if;
    end loop;

    if v_changed then
      update orders set production_stages = v_cur where id = it.id;
    end if;
  end loop;

  v_summary := jsonb_build_object(
    'kategoria', p_category,
    'tryb', case when p_dry_run then 'podglad' else 'zapis' end,
    'zlecen', v_zlecen,
    'uzupelnione', v_uzup,
    'zgodne', v_zgodne,
    'rozne', v_rozne,
    'nietypowe', v_nietyp
  );

  if p_run_id is not null then
    update excel_sync_runs
    set summary = coalesce(summary, '{}'::jsonb)
      || jsonb_build_object('etapy', v_summary, 'etapy_zmiany', v_zmiany, 'etapy_rozne', v_rozne_lista, 'etapy_nietypowe', v_nietyp_lista)
    where id = p_run_id;
  end if;

  return v_summary || jsonb_build_object('zmiany', v_zmiany, 'rozne_lista', v_rozne_lista, 'nietypowe_lista', v_nietyp_lista);
end;
$$;

comment on function public.sync_stages_from_excel(jsonb, boolean, bigint, text) is
  'Etapy z Excela → program (24.11.2026): uzupełnia tylko puste etapy zleceń z listy items (id + stages), raport do excel_sync_runs.summary.etapy.';

grant execute on function public.sync_stages_from_excel(jsonb, boolean, bigint, text) to service_role;
