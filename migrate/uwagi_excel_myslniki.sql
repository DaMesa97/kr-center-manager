-- 2026-10-23: uwagi „-” / „undefined” z importu Excela = brak uwag (46 zleceń).
-- Edge Function dynamic-handler v24 czyści je już przy imporcie (note() w mapExcelRow).
UPDATE public.orders SET notes = NULL
WHERE source = 'excel' AND notes IS NOT NULL AND public.clean_bot_text(notes) IS NULL;
UPDATE public.orders SET bastion_notes_2 = ''
WHERE source = 'excel' AND bastion_notes_2 IS NOT NULL AND bastion_notes_2 <> '' AND public.clean_bot_text(bastion_notes_2) IS NULL;
