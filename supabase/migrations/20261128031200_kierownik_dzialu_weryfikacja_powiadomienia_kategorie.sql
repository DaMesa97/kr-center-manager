-- 28.11.2026 — decyzja D11 (właściciel: TAK): kierownik działu widzi w Weryfikacji i w powiadomieniach tylko swoje
-- kategorie. Runda 8: obaj kierownicy działu (STA) mieli po 856 powiadomień „do weryfikacji”, 742 (87%) z innych
-- kategorii; reklamacje szły do wszystkich kierowników.
-- Korzysta z zakresu z 20261127234200 (current_user_order_in_scope: własne kategorie + zlecenia z nimi spięte —
-- para linked_order_id, Titan titan_group). Tu:
--  1) public.profile_order_in_scope(p_user, …) — ta sama reguła dla wskazanego konta (powiadomienia wysyła trigger,
--     więc auth.uid() to autor zmiany, nie odbiorca). Tylko do użytku wewnętrznego (bez grantu dla authenticated).
--  2) notify_managers_new_review: kierownik działu dostaje „Zamówienie do weryfikacji” tylko w swoim zakresie.
--  3) notify_managers_new_complaint: kierownik działu dostaje „Nowa reklamacja” tylko dla swoich kategorii
--     (kategoria reklamacji albo zlecenie reklamacji w zakresie).
--     Obie funkcje zachowują notify_user_active (20261128010000) i notify_muted (20261128010300) — tamte pliki
--     uruchomione po tym uznają łatkę za zrobioną.
--  4) get_orders_needing_review: kierownik działu dostaje tylko zlecenia w zakresie (aplikacja od tej wersji też
--     filtruje po kategorii, więc działa przed i po wgraniu).
--  5) Porządek: nieprzeczytane powiadomienia „review” / „complaint” kierowników działu spoza zakresu → przeczytane
--     (nie kasujemy; zostają w historii dzwonka). Zlecenia szukane w orders, potem w orders_archive; nieznalezione
--     zostają bez zmian.
-- Wymaga 20261127234200 (current_user_order_in_scope) — na produkcji już jest.
-- DO WDROŻENIA (nie wgrane).

-- 1) zakres dla wskazanego konta
create or replace function public.profile_order_in_scope(p_user uuid, p_id bigint, p_category text, p_linked bigint, p_extra jsonb)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  -- D11: ta sama reguła co current_user_order_in_scope, dla odbiorcy powiadomienia
  with me as (
    select p.role, coalesce(p.categories, '{}'::text[]) as cats
    from profiles p where p.id = p_user
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

revoke all on function public.profile_order_in_scope(uuid, bigint, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.profile_order_in_scope(uuid, bigint, text, bigint, jsonb) to service_role;

-- 2) „Zamówienie do weryfikacji”
create or replace function public.notify_managers_new_review()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_needs_review BOOLEAN;
BEGIN
  v_needs_review :=
    (NEW.extra_fields->>'needs_review')::boolean IS TRUE
    OR (
      jsonb_typeof(NEW.extra_fields->'warnings') = 'array'
      AND jsonb_array_length(NEW.extra_fields->'warnings') > 0
    );

  IF NEW.source IN ('bot', 'excel') AND v_needs_review AND NOT public.notify_muted() THEN
    INSERT INTO notifications (user_id, type, title, body, link_tab, link_order_id)
    SELECT
      p.id,
      'review',
      'Zamówienie do weryfikacji',
      'Zlecenie ' || COALESCE(NEW.order_number, '?') || ' (' || COALESCE(NEW.category, '?') || ') — ' ||
        COALESCE(NEW.company, '') || ' wymaga weryfikacji',
      'Weryfikacja',
      NEW.id
    FROM profiles p
    WHERE public.notify_user_active(p.id) and p.role in ('superadmin', 'admin', 'manager', 'kierownik_dzialu', 'kierownik_magazynu',
                     'kierownik_produkcji', 'kierownik_firmowy')
      -- D11: kierownik działu tylko w swoim zakresie kategorii
      and (p.role <> 'kierownik_dzialu'
           or public.profile_order_in_scope(p.id, NEW.id, NEW.category, NEW.linked_order_id, NEW.extra_fields));
  END IF;
  RETURN NEW;
END;
$function$;

-- 3) „Nowa reklamacja”
create or replace function public.notify_managers_new_complaint()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  INSERT INTO notifications (user_id, type, title, body, link_tab, link_order_id)
  SELECT
    p.id,
    'complaint',
    'Nowa reklamacja',
    'Reklamacja dla zlecenia ' || COALESCE(NEW.order_number, '?'),
    NEW.category,
    NULL
  FROM profiles p
  WHERE public.notify_user_active(p.id) and p.role in ('superadmin', 'admin', 'manager', 'kierownik_dzialu', 'kierownik_magazynu',
                   'kierownik_produkcji', 'kierownik_firmowy')
    -- D11: kierownik działu tylko reklamacje swoich kategorii (albo do zlecenia w swoim zakresie)
    and (p.role <> 'kierownik_dzialu'
         or NEW.category = any(coalesce(p.categories, '{}'::text[]))
         or exists (select 1 from orders o
                    where o.id = NEW.order_id
                      and public.profile_order_in_scope(p.id, o.id, o.category, o.linked_order_id, o.extra_fields)));
  RETURN NEW;
END;
$function$;

-- 4) lista Weryfikacji
create or replace function public.get_orders_needing_review()
 returns table(id bigint, order_number text, category text, client_order_number text, company text, model text, bot_received_at timestamp with time zone, warnings jsonb, api_key_id integer, raw_payload jsonb, source text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.category,
    o.client_order_number,
    o.company,
    o.model,
    COALESCE((o.extra_fields->>'bot_received_at')::timestamptz, o.created_at),
    o.extra_fields->'warnings',
    (o.extra_fields->>'api_key_id')::integer,
    o.extra_fields->'raw_payload',
    o.source
  FROM orders o
  WHERE (o.extra_fields->>'needs_review')::boolean = true
    -- D11: kierownik działu — tylko swój zakres kategorii (inne role bez zmian)
    AND public.current_user_order_in_scope(o.id, o.category, o.linked_order_id, o.extra_fields)
  ORDER BY COALESCE((o.extra_fields->>'bot_received_at')::timestamptz, o.created_at) ASC NULLS LAST;
END;
$function$;

-- 5) zaległe powiadomienia spoza zakresu → przeczytane
update notifications n
set is_read = true
from profiles p
where p.id = n.user_id
  and p.role = 'kierownik_dzialu'
  and n.is_read = false
  and n.type = 'review'
  and n.link_order_id is not null
  and coalesce(
        (select public.profile_order_in_scope(p.id, o.id, o.category, o.linked_order_id, o.extra_fields)
         from orders o where o.id = n.link_order_id),
        (select a.category = any(coalesce(p.categories, '{}'::text[]))
         from orders_archive a where a.id = n.link_order_id),
        true
      ) = false;

update notifications n
set is_read = true
from profiles p
where p.id = n.user_id
  and p.role = 'kierownik_dzialu'
  and n.is_read = false
  and n.type = 'complaint'
  and n.link_tab is not null
  and not (n.link_tab = any(coalesce(p.categories, '{}'::text[])));
