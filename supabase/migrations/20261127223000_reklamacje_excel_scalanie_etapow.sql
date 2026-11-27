-- 27.11.2026 (sesja testów, runda 2; tester reklamacji, KRYTYCZNY): sync_complaints_from_excel nadpisywał CAŁY zestaw
-- etapów reklamacji wartościami z Excela — etap kliknięty w programie (np. e1/e3) znikał przy synchronizacji co 15 min.
-- Teraz scalanie jak dla zleceń: Excel uzupełnia klucze, a niepuste wpisy z programu wygrywają.
-- Podmiana jednego wyrażenia w istniejącej funkcji (reszta bez zmian). DO WDROŻENIA (nie wgrane w sesji).
do $$
declare d text;
  stare text := 'production_stages = case when v_stages <> ''{}''::jsonb then v_stages else c.production_stages end';
  nowe text := 'production_stages = case when v_stages <> ''{}''::jsonb then v_stages || coalesce((select jsonb_object_agg(e.k, e.v) from jsonb_each(coalesce(c.production_stages, ''{}''::jsonb)) e(k, v) where coalesce(e.v #>> ''{}'', '''') <> ''''), ''{}''::jsonb) else c.production_stages end';
begin
  d := pg_get_functiondef('public.sync_complaints_from_excel(jsonb,text,text,boolean)'::regprocedure);
  if position(stare in d) = 0 then
    raise notice 'sync_complaints_from_excel: wyrażenie już poprawione albo inne — bez zmian';
    return;
  end if;
  execute replace(d, stare, nowe);
end $$;
