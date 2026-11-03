-- =====================================================================
-- Status RO z Optimy w aplikacji — powiadomienia i indeksy (4.11.2026).
--
-- Kolumny orders.erp_* oraz set_erp_status / orders_apply_erp_status /
-- edge erp-status są już w bazie i NIE są tu ruszane (pisze je Make).
--
-- 1. Indeksy: lista „Błędy ERP" (erp_status = NIEPOMYŚLNY, najnowsze na
--    górze) i szukanie po numerze RO (na później).
-- 2. Trigger powiadomień: gdy zlecenie dostaje NIEPOMYŚLNY (nowy albo
--    zmieniony błąd), wpis w notifications typu 'erp_error' dla
--    admin / manager / kierownik_produkcji / kierownik_firmowy — tych, którzy
--    poprawiają w Airtable („Błędy automatyzacji (Optima)" → Ponów wysyłkę).
--    Jedno powiadomienie na zamówienie z konfiguratora: set_erp_status
--    kopiuje status także na partnera pary Disting Plus i nogi Titana, ale
--    airtable_id ma tylko wiersz główny (sprawdzone: 0 par z dwoma
--    airtable_id, 0 nóg Titana z airtable_id) — partnerów pomijamy.
--    Ten sam błąd nie wysyła się drugi raz (dedupe po treści, 1 dzień).
-- Idempotentne.
-- =====================================================================

create index if not exists orders_erp_error_idx
  on public.orders (erp_updated_at desc)
  where erp_status = 'NIEPOMYŚLNY';

create index if not exists orders_erp_ro_number_idx
  on public.orders (erp_ro_number)
  where erp_ro_number is not null;

create or replace function public.notify_erp_error()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_err text;
  v_title text;
  v_body text;
begin
  if coalesce(new.erp_status, '') <> 'NIEPOMYŚLNY' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.erp_status is not distinct from new.erp_status
     and old.erp_error is not distinct from new.erp_error then
    return new;
  end if;
  -- partner pary / noga Titana (status skopiowany przez set_erp_status) — bez osobnego powiadomienia
  if coalesce(new.airtable_id, '') = '' then
    return new;
  end if;

  v_err := nullif(trim(coalesce(new.erp_error, '')), '');
  v_title := 'Błąd Optimy (RO): ' || coalesce(nullif(trim(new.order_number), ''), '?') || ' (' || coalesce(new.category, '?') || ')';
  v_body := coalesce(v_err, 'RO nie powstało — Make nie podał treści błędu')
    || case when coalesce(trim(new.company), '') <> '' then ' · ' || trim(new.company) else '' end
    || ' · Poprawka: Airtable → Błędy automatyzacji (Optima) → Ponów wysyłkę';

  insert into notifications (user_id, type, title, body, link_tab, link_order_id)
  select p.id, 'erp_error', v_title, v_body, 'Weryfikacja', new.id
  from profiles p
  where p.role in ('admin', 'manager', 'kierownik_produkcji', 'kierownik_firmowy')
    and not exists (
      select 1 from notifications n
      where n.user_id = p.id and n.type = 'erp_error' and n.link_order_id = new.id
        and n.body = v_body and n.created_at > now() - interval '1 day'
    );
  return new;
end;
$function$;

drop trigger if exists trg_notify_erp_error on public.orders;
create trigger trg_notify_erp_error
  after insert or update of erp_status, erp_error on public.orders
  for each row execute function public.notify_erp_error();
