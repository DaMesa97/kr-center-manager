-- 27.11.2026 wieczorem (testy agentów): numer WZR — lpad(..., 3) w Postgresie OBCINA dłuższy tekst, więc 1000. dokument
-- w roku dostałby „WZR/RRRR/100” (duplikat, zapis pada i kolejnych WZR nie da się wystawić). Teraz zera tylko dopełniają.
-- Podmiana jednego wyrażenia w istniejącej funkcji (reszta bez zmian). Uruchamiane konektorem (apply_migration wzr_numer_ponad_999).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.create_wz_reklamacyjny'::regproc);
  if position('lpad(v_nr::text, 3, ''0'')' in d) = 0 then
    raise notice 'create_wz_reklamacyjny: wyrażenie już poprawione albo inne — bez zmian';
    return;
  end if;
  d := replace(d, 'lpad(v_nr::text, 3, ''0'')', 'lpad(v_nr::text, greatest(3, length(v_nr::text)), ''0'')');
  execute d;
end $$;
