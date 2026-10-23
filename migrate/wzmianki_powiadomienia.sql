-- 2026-10-23: wzmianki @ w komentarzach znowu powiadamiają.
--
-- Od rls_hardening (lipiec) notifications_insert ma WITH CHECK (user_id = auth.uid())
-- — klient może wstawić powiadomienie tylko SOBIE. OrderCommentsPanel wstawiał
-- powiadomienia OZNACZONYM osobom bezpośrednio → RLS po cichu je odrzucał
-- (ostatnia „mention” w bazie: 15.06). Reguła RLS jest dobra (inaczej każdy
-- mógłby wysłać komukolwiek dowolny komunikat), więc wzmianki idą przez RPC:
--  * tylko zalogowany, tylko istniejące zlecenie, max 20 osób na raz,
--  * typ i tytuł ustala serwer, treść = numer zlecenia + początek komentarza,
--  * bez powiadamiania samego siebie i nieistniejących profili.

CREATE OR REPLACE FUNCTION public.notify_comment_mentions(p_order_id bigint, p_user_ids uuid[], p_content text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Wymagane zalogowanie';
  end if;
  select o.order_number, o.category into v_order from orders o where o.id = p_order_id;
  if not found then
    raise exception 'Zlecenie % nie istnieje', p_order_id;
  end if;
  if coalesce(array_length(p_user_ids, 1), 0) > 20 then
    raise exception 'Za dużo oznaczonych osób naraz (max 20)';
  end if;

  insert into notifications (user_id, type, title, body, link_tab, link_order_id)
  select distinct p.id, 'mention', 'Oznaczono Cię w komentarzu',
         'Zlecenie ' || coalesce(v_order.order_number, '') || ': ' || left(coalesce(p_content, ''), 100),
         nullif(v_order.category, ''), p_order_id
  from profiles p
  where p.id = any(p_user_ids)
    and p.id <> auth.uid();
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

REVOKE ALL ON FUNCTION public.notify_comment_mentions(bigint, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_comment_mentions(bigint, uuid[], text) TO authenticated;
