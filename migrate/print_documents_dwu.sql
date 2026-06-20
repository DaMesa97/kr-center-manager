-- =====================================================================
-- Pakiet DWU (#7/#8/#13): atrybuty doboru DoP do zamówienia.
-- Każda kolumna NULL/'' = "dowolne" (dokument pasuje niezależnie od tej cechy).
-- Ustawione = dokument dobierany tylko gdy cecha zamówienia się zgadza.
--
-- Dobór: kategoria (wymagana) + system + realizator + szklone/pełne + ościeżnica.
--   wykonawca    : 'Center' | 'Profil' | 'WZ'   (realizator zlecenia)
--   glazing_type : 'szklone' | 'pelne'          (po polu szklenie)
--   frame_kind   : 'stalowa' | 'drewniana'      (gł. Bastion — stalowa ma osobną DWU)
-- =====================================================================
alter table public.print_documents add column if not exists wykonawca    text;
alter table public.print_documents add column if not exists glazing_type text;
alter table public.print_documents add column if not exists frame_kind   text;
