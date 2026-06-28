-- =====================================================================
-- Bastion: panel boczny/górny — płaski element doklejany do ościeżnicy
-- jako wykończenie. NIE wlicza się do szerokości montażowej zestawu.
-- Panel boczny w dwóch wariantach (jak dostawki): strona KLAMKOWA i
-- PRZECIWKLAMKOWA (wspólna wysokość). Panel górny osobno.
-- Format wartości: "SZER×WYS" (mm), np. "370×2080".
-- =====================================================================
alter table public.orders add column if not exists bastion_side_panel_k text; -- boczny klamkowy
alter table public.orders add column if not exists bastion_side_panel_p text; -- boczny przeciwklamkowy
alter table public.orders add column if not exists bastion_top_panel    text; -- górny
