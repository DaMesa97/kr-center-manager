-- 24.10: usunięta pusta receptura 55 (0 składników) — wygrywała dobór dla STA skrzydło
-- ORZECH 80E NICOLO/VENTO/ASTRE, więc te zlecenia nie rezerwowały NIC na skrzydło.
-- Po usunięciu przeliczone rezerwacje otwartych STA (rebuild_reservations_for_category).
-- Odtworzenie (gdyby była potrzebna — wtedy DODAJ jej składniki, inaczej znów zablokuje dobór):

insert into public.warehouse_recipes (id, name, category, part, is_active, created_at)
values (55, 'STA / Skrzydło / NORMAL|NORMAL PLUS|NORMAL PLUS RC2 / ORZECH / 80E / NICOLO 01|NICOLO 04|NICOLO 05|NICOLO 05B|NICOLO 11|NICOLO 12|NICOLO 12B|NICOLO 17B|NICOLO 31|NICOLO 32|NICOLO 32B|NICOLO 33|NICOLO 33B|NICOLO 34|NICOLO 35|NICOLO 35B|VENTO 01|VENTO 02|VENTO 02B|VENTO 11|VENTO 12|VENTO 12B|VETNO 13|VENTO 13B|VENTO 31|VENTO 32|VENTO 32B|VENTO 33|VENTO 33B|VENTO 34|ASTRE 12|ASTRE 12B|ASTRE 13|ASTRE 13B',
        'STA', 'wing', true, '2026-07-28T08:23:34.529585+00:00');

insert into public.warehouse_recipe_criteria (recipe_id, field, allowed_values) values
  (55, 'system', array['NORMAL','NORMAL PLUS','NORMAL PLUS RC2']),
  (55, 'wing_color', array['ORZECH']),
  (55, 'width', array['80E']),
  (55, 'model', array['NICOLO 01','NICOLO 04','NICOLO 05','NICOLO 05B','NICOLO 11','NICOLO 12','NICOLO 12B','NICOLO 17B','NICOLO 31','NICOLO 32','NICOLO 32B','NICOLO 33','NICOLO 33B','NICOLO 34','NICOLO 35','NICOLO 35B','VENTO 01','VENTO 02','VENTO 02B','VENTO 11','VENTO 12','VENTO 12B','VENTO 13','VENTO 13B','VENTO 31','VENTO 32','VENTO 32B','VENTO 33','VENTO 33B','VENTO 34','ASTRE 12','ASTRE 12B','ASTRE 13','ASTRE 13B']);
