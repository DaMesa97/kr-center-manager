-- 2026-10-23: uprawnienia w bazie zgodne z aplikacją (permissions.ts).
--
-- * orders INSERT/UPDATE wpuszczały też magazyniera i obsługę klienta — do
--   KAŻDEGO pola KAŻDEGO zlecenia (przez API, z pominięciem aplikacji). Aplikacja:
--   zakładanie i edycja tylko dla kierowników; magazynier jedynie oznacza
--   „✓ Wydane” przy drzwiach wewnętrznych (InternalDoorOrderDetailsModal);
--   obsługa klienta niczego w zleceniach nie zapisuje. Etapy, magazyn, bot i
--   Excel idą przez funkcje SECURITY DEFINER / service_role — RLS ich nie dotyczy.
-- * app_config (min_app_version, route_plan_webhook_url …) mógł zmieniać każdy
--   kierownik — np. podmienić adres webhooka. Aplikacja nie zapisuje tej tabeli
--   wcale; zmiany robi admin → zapis tylko admin.

DROP POLICY IF EXISTS orders_insert ON public.orders;
CREATE POLICY orders_insert ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.current_user_is_manager()));

DROP POLICY IF EXISTS orders_update ON public.orders;
CREATE POLICY orders_update ON public.orders
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.current_user_is_manager())
    OR (
      category = 'DrzwiWewnetrzne'
      AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'magazynier')
    )
  )
  WITH CHECK (
    (SELECT public.current_user_is_manager())
    OR (
      category = 'DrzwiWewnetrzne'
      AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'magazynier')
    )
  );

DROP POLICY IF EXISTS app_config_write ON public.app_config;
CREATE POLICY app_config_write ON public.app_config
  FOR ALL TO authenticated
  USING ((SELECT public.current_user_is_admin()))
  WITH CHECK ((SELECT public.current_user_is_admin()));
