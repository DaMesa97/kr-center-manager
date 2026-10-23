-- Drobnica z przeglądu paczki 23.10 (wdrożone przez MCP jako drobnica_przegladu_23_10)

-- 1) Wzmianki @: powiadomienie tylko dla komentarza, który autor NAPRAWDĘ dodał na tym
--    zleceniu (ta sama treść). Wcześniej przez API dało się wysłać dowolny tekst
--    „Oznaczono Cię w komentarzu” do 20 dowolnych osób.
create or replace function public.notify_comment_mentions(p_order_id bigint, p_user_ids uuid[], p_content text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  if not exists (
    select 1 from order_comments c
    where c.order_id = p_order_id and c.author_id = auth.uid() and c.content = p_content
  ) then
    raise exception 'Brak takiego komentarza autora na tym zleceniu';
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

-- 2) merge_order_extra_fields: RLS odrzucający update zwracał NULL bez błędu → każde
--    wywołanie (odbiór ościeżnicy, anulowanie, X/XX, fakturowanie) udawało sukces.
create or replace function public.merge_order_extra_fields(p_order_id bigint, p_patch jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_extra jsonb;
begin
  update orders
  set extra_fields = coalesce(extra_fields, '{}'::jsonb) || p_patch
  where id = p_order_id
  returning extra_fields into v_extra;
  if not found then
    raise exception 'Nie zapisano zmiany zlecenia (id %) — brak uprawnień albo zlecenie nie istnieje', p_order_id
      using errcode = '42501';
  end if;
  return v_extra;
end;
$function$;
