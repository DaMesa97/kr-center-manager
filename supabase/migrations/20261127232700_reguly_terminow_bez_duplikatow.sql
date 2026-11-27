-- 27.11.2026 (testy 27.11, runda 3; CEO/statystyki): każda z 4 reguł terminów realizacji (order_lead_time_rules)
-- była w tabeli dwa razy z identycznymi wartościami (id 1–4 i 5–8, wstawione 30.05 dwukrotnie). Usuwamy duplikaty —
-- zostaje najniższe id z każdej grupy (1, 2, 3, 4) — i dodajemy unikalność na kolumny definiujące regułę
-- (kategoria / szkło-dostawka / rodzaj ościeżnicy; NULL = „dowolna”, więc NULLS NOT DISTINCT), żeby z ekranu
-- konfiguracji nie dało się dodać drugiej reguły o tych samych warunkach.
-- Usunięcie dotyczy tylko wierszy identycznych w kolumnach reguły (sprawdzone 27.11: 4 wiersze, id 5–8).
-- Poprawka (testy 27.11, runda 3; ŚREDNI): unikalność i usuwanie duplikatów tylko wśród AKTYWNYCH reguł
-- (where is_active) — wyłączona reguła nie blokuje dodania nowej o tych samych warunkach i nie jest kasowana.
-- DO WDROŻENIA (nie wgrane w sesji).
delete from public.order_lead_time_rules r
where r.is_active
  and exists (
    select 1 from public.order_lead_time_rules s
    where s.id < r.id
      and s.is_active
      and s.match_category is not distinct from r.match_category
      and s.match_has_glass_extra is not distinct from r.match_has_glass_extra
      and s.match_bastion_frame_type is not distinct from r.match_bastion_frame_type
  );

create unique index if not exists order_lead_time_rules_warunki_uniq
  on public.order_lead_time_rules (match_category, match_has_glass_extra, match_bastion_frame_type) nulls not distinct
  where is_active;
