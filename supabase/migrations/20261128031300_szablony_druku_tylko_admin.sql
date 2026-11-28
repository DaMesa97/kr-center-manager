-- 28.11.2026 — decyzja D59 (właściciel: TAK): szablony etykiet i dokumentów druku edytuje tylko admin / superadmin.
-- Było: zapis do label_templates (szablony etykiet, HTML) i print_documents (gotowe dokumenty ZPL / DoP PDF do druku
-- na hali) miał każdy kierownik (current_user_is_manager — także kierownik działu, dla wszystkich kategorii).
-- Szablon to HTML/ZPL — druk zbiorczy i wydruk go renderują, więc treść etykiety mogła zostać celowo popsuta.
-- Teraz insert / update / delete tylko current_user_is_admin() (admin, superadmin, stary 'manager' — ta sama
-- funkcja co app_config, companies, reguły terminów). Odczyt bez zmian (druk potrzebuje szablonów wszystkim).
-- Aplikacja od tej wersji chowa przyciski edycji dla innych ról (permissions.ts: canEditPrintTemplates).
-- Audyt zmian label_templates: 20261128010500 (osobny plik, niezależny).
-- DO WDROŻENIA (nie wgrane). Samodzielny.

drop policy if exists label_templates_insert on public.label_templates;
create policy label_templates_insert on public.label_templates
  for insert to authenticated
  with check ((select public.current_user_is_admin()));

drop policy if exists label_templates_update on public.label_templates;
create policy label_templates_update on public.label_templates
  for update to authenticated
  using ((select public.current_user_is_admin()))
  with check ((select public.current_user_is_admin()));

drop policy if exists label_templates_delete on public.label_templates;
create policy label_templates_delete on public.label_templates
  for delete to authenticated
  using ((select public.current_user_is_admin()));

drop policy if exists print_documents_insert on public.print_documents;
create policy print_documents_insert on public.print_documents
  for insert to authenticated
  with check ((select public.current_user_is_admin()));

drop policy if exists print_documents_update on public.print_documents;
create policy print_documents_update on public.print_documents
  for update to authenticated
  using ((select public.current_user_is_admin()))
  with check ((select public.current_user_is_admin()));

drop policy if exists print_documents_delete on public.print_documents;
create policy print_documents_delete on public.print_documents
  for delete to authenticated
  using ((select public.current_user_is_admin()));
