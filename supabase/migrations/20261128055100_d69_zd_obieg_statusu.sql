-- 28.11.2026 — decyzja D69 (właściciel: TAK, opcja a): status całej ZD (purchase_orders) zmieniany z pominięciem obiegu.
-- Problem: polityka po_modify pozwala każdemu z rolą zakupową zmienić status ZD dowolnie (np. wysłana → szkic →
-- edycja pozycji → z powrotem wysłana, albo „zrealizowana” bez przyjęcia towaru) oraz skasować całą wysłaną ZD —
-- kaskada pozycji przechodzi, bo strażnik pozycji (20261128021100) nie widzi już ZD (status null = kaskada).
-- Teraz trigger BEFORE UPDATE OR DELETE na purchase_orders:
--  - DELETE: tylko szkic ('draft'). Wysłaną / częściową ZD się anuluje (cancel_purchase_order), nie kasuje.
--  - UPDATE status — dozwolone przejścia (ten sam status zawsze wolno):
--      draft   → sent, cancelled
--      sent    → partial, completed, cancelled, draft (cofnięcie do szkicu — tylko bez przyjęć; czyści sent_at/sent_by)
--      partial → completed, cancelled
--      completed, cancelled → nic (stan końcowy)
--    oraz zgodność z pozycjami:
--      partial   — musi być przyjęta jakaś ilość,
--      completed — musi być przyjęta jakaś ilość i żadna pozycja nie może czekać (pending / partial),
--      cancelled — żadna pozycja nie może czekać.
--  - Audyt: audit_trigger_fn na purchase_orders (każda zmiana statusu, w tym cofnięcie do szkicu, i usunięcie
--    szkicu zostawia wpis w audit_log z poprzednim stanem).
-- Sprawdzone z funkcjami bazy (28.11, kod z produkcji): mark_purchase_order_sent (draft → sent),
-- receive_purchase_order (sent/partial → partial/completed, pozycje zmienia PRZED statusem), cancel_purchase_order
-- (draft/sent/partial → cancelled/completed, pozycje zamyka PRZED statusem), cancel_purchase_order_item (po zamknięciu
-- ostatniej pozycji → completed/cancelled) — wszystkie mieszczą się w regułach. Aplikacja nie kasuje ZD i nie zmienia
-- statusu bezpośrednio (tylko przez te funkcje).
-- Stan 28.11: 3 wysłane, 1 zrealizowana, 3 anulowane — żadna nie łamie reguł (trigger nie sprawdza istniejących).
-- Wyjątek serwisowy jak w 20261128021100: sesja postgres bez zalogowanego użytkownika (SQL Editor, skrypt porządków).
-- Nie zależy od niewgranych plików. Plik można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane).

create or replace function public.purchase_orders_status_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_przyjete boolean;
  v_czekaja  boolean;
begin
  -- serwis (SQL Editor / skrypt porządków): bez zalogowanego użytkownika
  if session_user = 'postgres' and auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.status is distinct from 'draft' then
      raise exception 'Usunąć można tylko szkic zamówienia (ZD % ma status %). Wysłane zamówienie anuluj przyciskiem „Anuluj zamówienie”.',
        old.zd_number, old.status using errcode = 'P0420';
    end if;
    return old;
  end if;

  -- UPDATE: interesuje nas tylko zmiana statusu
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not (
       (old.status = 'draft'   and new.status in ('sent', 'cancelled'))
    or (old.status = 'sent'    and new.status in ('partial', 'completed', 'cancelled', 'draft'))
    or (old.status = 'partial' and new.status in ('completed', 'cancelled'))
  ) then
    raise exception 'Niedozwolona zmiana statusu ZD %: % → %. Obieg: szkic → wysłana → częściowa → zrealizowana (albo anulowana).',
      old.zd_number, old.status, new.status using errcode = 'P0420';
  end if;

  select coalesce(bool_or(coalesce(i.quantity_received, 0) > 0), false),
         coalesce(bool_or(i.status_per_item in ('pending', 'partial')), false)
    into v_przyjete, v_czekaja
    from purchase_order_items i
   where i.purchase_order_id = new.id;

  if new.status = 'draft' then
    if v_przyjete then
      raise exception 'ZD % ma już przyjęty towar — nie można jej cofnąć do szkicu.', old.zd_number
        using errcode = 'P0420';
    end if;
    -- szkic nie jest wysłany; ponowne wysłanie (mark_purchase_order_sent) wpisze datę i osobę od nowa
    new.sent_at := null;
    new.sent_by := null;
  elsif new.status = 'partial' and not v_przyjete then
    raise exception 'ZD % nie ma przyjętego towaru — status „częściowa” ustawia przyjęcie dostawy.', old.zd_number
      using errcode = 'P0420';
  elsif new.status = 'completed' and (not v_przyjete or v_czekaja) then
    raise exception 'ZD % nie może być zrealizowana: %.', old.zd_number,
      case when not v_przyjete then 'nie przyjęto żadnego towaru (anuluj ją)'
           else 'część pozycji czeka na dostawę (przyjmij je albo zamknij)' end
      using errcode = 'P0420';
  elsif new.status = 'cancelled' and v_czekaja then
    raise exception 'ZD %: najpierw zamknij otwarte pozycje (przycisk „Anuluj zamówienie” robi to sam).', old.zd_number
      using errcode = 'P0420';
  end if;

  return new;
end;
$function$;

revoke all on function public.purchase_orders_status_guard() from public, anon, authenticated;

drop trigger if exists trg_purchase_orders_status_guard on public.purchase_orders;
create trigger trg_purchase_orders_status_guard
  before update or delete on public.purchase_orders
  for each row execute function public.purchase_orders_status_guard();

drop trigger if exists audit_purchase_orders on public.purchase_orders;
create trigger audit_purchase_orders
  after insert or update or delete on public.purchase_orders
  for each row execute function public.audit_trigger_fn();
