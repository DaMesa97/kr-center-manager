-- 27.11.2026 (sesja testów, runda 2; tester reklamacji, KRYTYCZNY): sync_complaints_from_excel nadpisywał CAŁY zestaw
-- etapów reklamacji wartościami z Excela — etap kliknięty w programie (np. e1/e3) znikał przy synchronizacji co 15 min.
-- Teraz scalanie jak dla zleceń: Excel uzupełnia klucze, a niepuste wpisy z programu wygrywają.
-- Poprawka (testy 27.11, runda 3; WYSOKI): warunek WHERE porównywał etapy z samym Excelem (v_stages), a wynik
-- scalania prawie zawsze się od niego różni → UPDATE co 15 min w kółko (audit_log, realtime, zawyżony licznik
-- „zaktualizowane”; reklamacja id 402). Teraz WHERE porównuje z WYNIKIEM scalania. Scalanie zaczyna się od pełnego
-- zestawu z programu (także pustych kluczy), więc gdy Excel nie wnosi nic nowego, wynik = stan obecny i UPDATE nie idzie.
-- Zasada bez zmian: Excel uzupełnia puste, program wygrywa.
-- Podmiana dwóch wyrażeń w istniejącej funkcji (reszta bez zmian). DO WDROŻENIA (nie wgrane w sesji).
do $$
declare d text;
  scal text := 'coalesce(c.production_stages, ''{}''::jsonb) || v_stages || coalesce((select jsonb_object_agg(e.k, e.v) from jsonb_each(coalesce(c.production_stages, ''{}''::jsonb)) e(k, v) where coalesce(e.v #>> ''{}'', '''') <> ''''), ''{}''::jsonb)';
  stare1 text := 'production_stages = case when v_stages <> ''{}''::jsonb then v_stages else c.production_stages end';
  stare2 text := 'or (v_stages <> ''{}''::jsonb and c.production_stages is distinct from v_stages)';
begin
  d := pg_get_functiondef('public.sync_complaints_from_excel(jsonb,text,text,boolean)'::regprocedure);
  if position(stare1 in d) = 0 or position(stare2 in d) = 0 then
    raise notice 'sync_complaints_from_excel: wyrażenia już poprawione albo inne — bez zmian';
    return;
  end if;
  d := replace(d, stare1, 'production_stages = case when v_stages <> ''{}''::jsonb then ' || scal || ' else c.production_stages end');
  d := replace(d, stare2, 'or (v_stages <> ''{}''::jsonb and c.production_stages is distinct from (' || scal || '))');
  execute d;
end $$;
