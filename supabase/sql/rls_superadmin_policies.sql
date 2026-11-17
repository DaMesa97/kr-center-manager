-- RLS: rola superadmin (beta.101, 14.11.2026) nie była wpisana w polityki ze sztywną listą ról —
-- superadmin (konto T) nie mógł m.in. zapisać/anulować reklamacji ani pisać do tabel magazynu, dostawców, etapów pracowników.
-- Wygenerowane 17.11.2026 z pg_policies: do każdej listy ról dopisany 'superadmin' (bez zmiany reszty warunku).
-- Reklamacje: jak orders — current_user_is_manager() (zawiera superadmina).
-- Uruchomić w Supabase → SQL Editor (ALTER POLICY nie kasuje polityk, tylko podmienia warunek).

alter policy complaints_insert on public.complaints with check (public.current_user_is_manager());
alter policy complaints_update on public.complaints using (public.current_user_is_manager());
alter policy complaints_delete on public.complaints using (public.current_user_is_manager());
alter policy alert_thresholds_modify_mgr on public.alert_thresholds using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text])))))) with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy alert_thresholds_select_mgr on public.alert_thresholds using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy api_logs_manager on public.api_request_logs using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy archive_run_log_select_manager on public.archive_run_log using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy audit_log_select_manager on public.audit_log using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy company_settings_modify on public.company_settings using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text])))))) with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy exclusions_delete on public.config_exclusions using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy exclusions_insert on public.config_exclusions with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy dimension_map_write on public.dimension_map using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy ext_profile_write on public.extension_profile_width_map using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy glass_allowances_write on public.glass_allowances using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy login_attempts_select_manager on public.login_attempts using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy order_comments_delete_self_or_manager on public.order_comments using (((author_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text])))))));
alter policy oidi_modify_mgr_seller on public.order_internal_door_items using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text, 'sprzedawca'::text])))))) with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text, 'sprzedawca'::text]))))));
alter policy orders_archive_select_manager on public.orders_archive using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy po_items_modify on public.purchase_order_items using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text])) OR ((profiles.role = 'worker'::text) AND (profiles.department = 'magazyn'::text))))))) with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text])) OR ((profiles.role = 'worker'::text) AND (profiles.department = 'magazyn'::text)))))));
alter policy po_modify on public.purchase_orders using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text])) OR ((profiles.role = 'worker'::text) AND (profiles.department = 'magazyn'::text))))))) with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text])) OR ((profiles.role = 'worker'::text) AND (profiles.department = 'magazyn'::text)))))));
alter policy seasonal_factors_manager_modify on public.seasonal_factors using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text])))))) with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy suppliers_modify_managers on public.suppliers using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text])))))) with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy warehouse_assignment_write on public.warehouse_assignment using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy warehouse_components_write on public.warehouse_components using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy warehouse_movements_write on public.warehouse_movements using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy warehouse_recipe_components_write on public.warehouse_recipe_components using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy warehouse_recipes_write on public.warehouse_recipes using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy warehouse_stock_write on public.warehouse_stock using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy warehouses_write on public.warehouses using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy worker_stages_delete_manager on public.worker_stages using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy worker_stages_insert_manager on public.worker_stages with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));
alter policy worker_stages_select_manager on public.worker_stages using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['superadmin'::text, 'manager'::text, 'admin'::text, 'kierownik_dzialu'::text, 'kierownik_magazynu'::text, 'kierownik_produkcji'::text, 'kierownik_firmowy'::text]))))));

-- Kontrola po uruchomieniu (ma zwrócić 0 wierszy):
-- select tablename, policyname from pg_policies where (coalesce(qual,'')||coalesce(with_check,'')) ilike '%kierownik_firmowy%' and (coalesce(qual,'')||coalesce(with_check,'')) not ilike '%superadmin%' and (coalesce(qual,'')||coalesce(with_check,'')) not ilike '%current_user_is_manager%';

