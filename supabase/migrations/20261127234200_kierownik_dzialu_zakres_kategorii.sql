-- 27.11.2026 (testy 27.11, runda 3; WYSOKI): kierownik działu nie miał w bazie zakresu kategorii.
-- Polityki orders_update / orders_delete wpuszczały każdego current_user_is_manager(): kierownik działu STA
-- (3ca6a57a…) zmienił datę wydania Bastion, anulował Aluminium, SKASOWAŁ zlecenie Techniczne, zmienił 8 reguł
-- terminów i 2923 kontrahentów. W aplikacji kierownik działu (permissions.ts: categories.scoped) widzi tylko
-- przypisane kategorie (profiles.categories, te same nazwy co orders.category), a Kontrahenci i Konfiguracja
-- (reguły terminów) są tylko dla admina (utils.ts: zakładki).
-- Teraz:
--  1) orders_update: kierownik działu tylko zlecenia swoich kategorii ORAZ zlecenia z nimi spięte (para przez
--     linked_order_id, trójka Titan przez extra_fields.titan_group — aplikacja przy zapisie STA/Disting zakłada
--     i synchronizuje nogi ST / Bastion / STA). Pozostali kierownicy i admin — jak dotąd; magazynier — jak dotąd
--     (DrzwiWewnetrzne). WITH CHECK to samo na nowym wierszu (kierownik działu nie przeniesie zlecenia poza zakres).
--  2) orders_delete: admin/superadmin (current_user_is_admin) albo kierownik, który SAM założył to zlecenie
--     w ostatnich 10 minutach (aplikacja kasuje tylko przy cofaniu nieudanego zakładania: useOrders.ts,
--     InternalDoorOrderModal.tsx). Autora rozpoznajemy po wpisie INSERT w audit_log (trigger audit_orders,
--     user_id = auth.uid()) — kolumna entered_by to wpisywane imię, nie identyfikator. Kierownik działu dodatkowo
--     tylko w swoim zakresie.
--  3) order_lead_time_rules (zapis) i companies (zmiana / usuwanie): tylko admin/superadmin. Dodawanie kontrahenta
--     zostaje kierownikom — formularz zlecenia ma „Utwórz kontrahenta z nazwy” (App.tsx handleCreateCompanyFromName).
-- DO WDROŻENIA (nie wgrane w sesji).

-- czy zlecenie jest w zakresie zalogowanego (dla ról innych niż kierownik działu zawsze tak)
create or replace function public.current_user_order_in_scope(p_id bigint, p_category text, p_linked bigint, p_extra jsonb)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  -- testy 27.11 (runda 3): zakres kategorii kierownika działu
  with me as (
    select p.role, coalesce(p.categories, '{}'::text[]) as cats
    from profiles p where p.id = auth.uid()
  )
  select case
    when not exists (select 1 from me where me.role = 'kierownik_dzialu') then true
    else exists (
      select 1 from me
      where p_category = any(me.cats)
         or exists (
              select 1 from orders x
              where x.category = any(me.cats)
                and (x.id = p_linked
                     or (p_id is not null and x.linked_order_id = p_id)
                     or (nullif(p_extra->>'titan_group', '') is not null
                         and (x.id::text = p_extra->>'titan_group'
                              or x.extra_fields->>'titan_group' = p_extra->>'titan_group')))
            )
    )
  end;
$function$;

revoke all on function public.current_user_order_in_scope(bigint, text, bigint, jsonb) from public, anon;
grant execute on function public.current_user_order_in_scope(bigint, text, bigint, jsonb) to authenticated, service_role;

-- czy zalogowany może skasować zlecenie
create or replace function public.current_user_can_delete_order(p_id bigint, p_category text, p_linked bigint, p_extra jsonb, p_created_at timestamptz)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  -- testy 27.11 (runda 3): admin albo autor w ciągu 10 minut (cofanie nieudanego zakładania)
  select public.current_user_is_admin()
      or (public.current_user_is_manager()
          and p_created_at > now() - interval '10 minutes'
          and public.current_user_order_in_scope(p_id, p_category, p_linked, p_extra)
          and exists (
                select 1 from audit_log a
                where a.table_name = 'orders' and a.record_id = p_id::text
                  and a.operation = 'INSERT' and a.user_id = auth.uid()
              ));
$function$;

revoke all on function public.current_user_can_delete_order(bigint, text, bigint, jsonb, timestamptz) from public, anon;
grant execute on function public.current_user_can_delete_order(bigint, text, bigint, jsonb, timestamptz) to authenticated, service_role;

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using (
    ((select public.current_user_is_manager())
       and public.current_user_order_in_scope(id, category, linked_order_id, extra_fields))
    or (category = 'DrzwiWewnetrzne'
        and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'magazynier'))
  )
  with check (
    ((select public.current_user_is_manager())
       and public.current_user_order_in_scope(id, category, linked_order_id, extra_fields))
    or (category = 'DrzwiWewnetrzne'
        and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'magazynier'))
  );

drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders
  for delete to authenticated
  using (public.current_user_can_delete_order(id, category, linked_order_id, extra_fields, created_at));

-- reguły terminów: zapis tylko admin (odczyt bez zmian — lead_time_read)
drop policy if exists lead_time_write on public.order_lead_time_rules;
create policy lead_time_write on public.order_lead_time_rules
  for all to authenticated
  using ((select public.current_user_is_admin()))
  with check ((select public.current_user_is_admin()));

-- kontrahenci: zmiana i usuwanie tylko admin; dodawanie — kierownicy jak dotąd (companies_insert bez zmian)
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update to authenticated
  using ((select public.current_user_is_admin()))
  with check ((select public.current_user_is_admin()));

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies
  for delete to authenticated
  using ((select public.current_user_is_admin()));
