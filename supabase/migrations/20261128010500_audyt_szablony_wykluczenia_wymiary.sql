-- 28.11.2026 (testy 27.11 (runda 3) — noc 28.11; NISKI): brak śladu zmian w tabelach konfiguracji.
-- 1) Audyt (audit_trigger_fn → audit_log) na tabelach, które zmieniają działanie programu, a nie miały żadnego triggera:
--    label_templates (szablony etykiet), config_exclusions (wykluczenia konfiguratora), dimension_map (mapa wymiarów),
--    order_lead_time_rules (reguły terminów). Wszystkie mają kolumnę id (wymaga jej audit_trigger_fn).
-- 2) label_templates: wymiary etykiety muszą być dodatnie (0 / ujemne / NaN psuły wydruk). Sprawdzone 28.11:
--    6 szablonów, żaden nie łamie warunku.
-- Plik można uruchamiać wielokrotnie. DO WDROŻENIA (nie wgrane w sesji).

drop trigger if exists audit_label_templates on public.label_templates;
create trigger audit_label_templates
  after insert or update or delete on public.label_templates
  for each row execute function public.audit_trigger_fn();

drop trigger if exists audit_config_exclusions on public.config_exclusions;
create trigger audit_config_exclusions
  after insert or update or delete on public.config_exclusions
  for each row execute function public.audit_trigger_fn();

drop trigger if exists audit_dimension_map on public.dimension_map;
create trigger audit_dimension_map
  after insert or update or delete on public.dimension_map
  for each row execute function public.audit_trigger_fn();

drop trigger if exists audit_order_lead_time_rules on public.order_lead_time_rules;
create trigger audit_order_lead_time_rules
  after insert or update or delete on public.order_lead_time_rules
  for each row execute function public.audit_trigger_fn();

alter table public.label_templates drop constraint if exists label_templates_size_check;
alter table public.label_templates add constraint label_templates_size_check
  check (width_mm > 0 and height_mm > 0 and width_mm <> 'NaN'::numeric and height_mm <> 'NaN'::numeric);
