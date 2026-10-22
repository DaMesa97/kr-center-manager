-- 2026-10-22: klucze API tylko dla admina.
-- Polityki api_keys wpuszczały do odczytu i zmian KAŻDEGO kierownika
-- (kierownik działu / magazynu / produkcji) — mógł podejrzeć, dezaktywować albo
-- zmienić limit klucza konfiguratora i Excela. Teraz tylko admin
-- (current_user_is_admin() = admin + stary 'manager'), tak jak zakładka
-- „Klucze API” w aplikacji i create_api_key (już miało guard admina).
-- Edge Functions (orders-intake, dynamic-handler) czytają klucze jako
-- service_role — RLS ich nie dotyczy.

DROP POLICY IF EXISTS api_keys_read_manager ON public.api_keys;
DROP POLICY IF EXISTS api_keys_modify_manager ON public.api_keys;

CREATE POLICY api_keys_read_admin ON public.api_keys
  FOR SELECT TO authenticated
  USING (public.current_user_is_admin());

CREATE POLICY api_keys_modify_admin ON public.api_keys
  FOR ALL TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());
