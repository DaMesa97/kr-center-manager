-- 28.11.2026 — decyzja właściciela (czat): „masowo przepiąć receptury na ościeżnicę ST na etap MONTAŻ”.
-- Powód: w ST etap „oścież.” (osc) jest „nie dotyczy” (#ND), bo ST nie frezuje ościeżnicy na CNC, a ościeżnica (rama)
-- MA schodzić z magazynu. Ościeżnica była w recepturach „ST / Ościeżnica / …” przypięta do etapu osc, więc #ND
-- anulował jej rezerwację (albo zwracał ją na stan) — teraz schodzi przy etapie „Montaż drzwi” (mon).
-- 1) receptury: stage_key osc → mon dla wszystkich pozycji receptur „ST / Ościeżnica / %” (ST55, ST55E, ST68 TERMO);
-- 2) otwarte zlecenia ST: przeliczenie niezrobionych etapów (przelicz_niezrobione_etapy__impl, D15) — rezerwacje ościeżnicy
--    przechodzą na etap mon; etapy zrobione i towar już wydany zostają bez zmian.
-- Progi (receptury „ST / Próg / …”, też na osc) — NIE ruszane (do decyzji właściciela).
-- Można uruchomić ponownie (pozycje już na mon są pomijane).
do $$
declare v_n int; v_o int := 0; r record;
begin
  update warehouse_recipe_components rc set stage_key = 'mon'
  from warehouse_recipes w
  where w.id = rc.recipe_id and w.category = 'ST' and w.name like 'ST / Ościeżnica /%' and rc.stage_key = 'osc';
  get diagnostics v_n = row_count;
  for r in select id from orders where category = 'ST' and release_date is null
            and coalesce(extra_fields->>'cancelled', 'false') <> 'true' order by id loop
    perform public.przelicz_niezrobione_etapy__impl(r.id);
    v_o := v_o + 1;
  end loop;
  raise notice 'st_oscieznica_na_montaz: pozycji receptur % → mon, przeliczonych zleceń %', v_n, v_o;
end $$;
