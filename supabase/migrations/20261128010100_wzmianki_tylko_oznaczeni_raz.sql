-- 28.11.2026 (testy 27.11 (runda 3) — noc 28.11; WYSOKI): notify_comment_mentions wywołane z konsoli (F12) w pętli
-- wysłało 65 powiadomień (5 wywołań × 13 osób) do komentarza bez żadnej wzmianki — funkcja ufała liście p_user_ids.
-- Teraz (zgodnie z aplikacją: OrderCommentsPanel.createMentionNotifications — osoba jest oznaczona, gdy treść
-- zawiera „@<full_name>”):
--  1) powiadomienie dostaje tylko osoba z p_user_ids, której „@Imię Nazwisko” (profiles.full_name) faktycznie jest
--     w treści komentarza; nie autor; tylko konto aktywne (notify_user_active z 20261128010000);
--  2) tylko raz na komentarz: pomijamy osobę, która ma już powiadomienie 'mention' o tej treści na tym zleceniu
--     utworzone po dodaniu komentarza (ponowne wywołanie = 0 nowych);
--  3) tylko świeży komentarz (do 1 godziny od dodania) — aplikacja woła funkcję zaraz po zapisie, więc stare
--     komentarze nie są „bramką” do rozsyłania (np. po usunięciu powiadomienia przez odbiorcę).
-- Zakres kategorii odbiorcy NIE jest sprawdzany: zlecenia czyta każdy zalogowany (polityka orders_read), a
-- profiles.categories ma skróty (STA…), nie nazwy kategorii zleceń — opisane w raporcie.
-- Wymaga 20261128010000 (notify_user_active). DO WDROŻENIA (nie wgrane w sesji).

create or replace function public.notify_comment_mentions(p_order_id bigint, p_user_ids uuid[], p_content text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order record;
  v_comment_at timestamptz;
  v_body text;
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
  -- najnowszy taki komentarz autora (testy 27.11 (runda 3), noc 28.11: wzmianki)
  select max(c.created_at) into v_comment_at
  from order_comments c
  where c.order_id = p_order_id and c.author_id = auth.uid() and c.content = p_content;
  if v_comment_at is null then
    raise exception 'Brak takiego komentarza autora na tym zleceniu';
  end if;
  if v_comment_at < now() - interval '1 hour' then
    return 0;  -- stary komentarz: powiadomienia wysyła się tylko zaraz po dodaniu
  end if;

  v_body := 'Zlecenie ' || coalesce(v_order.order_number, '') || ': ' || left(coalesce(p_content, ''), 100);

  insert into notifications (user_id, type, title, body, link_tab, link_order_id)
  select distinct p.id, 'mention', 'Oznaczono Cię w komentarzu', v_body,
         nullif(v_order.category, ''), p_order_id
  from profiles p
  where p.id = any(p_user_ids)
    and p.id <> auth.uid()
    -- tylko faktycznie oznaczeni w treści (jak w aplikacji: content.includes('@' + full_name))
    and nullif(trim(p.full_name), '') is not null
    and strpos(p_content, '@' || p.full_name) > 0
    -- bez kont zablokowanych / usuniętych
    and public.notify_user_active(p.id)
    -- tylko raz na komentarz
    and not exists (
      select 1 from notifications n
      where n.user_id = p.id and n.type = 'mention' and n.link_order_id = p_order_id
        and n.body = v_body and n.created_at >= v_comment_at
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.notify_comment_mentions(bigint, uuid[], text) from public, anon;
grant execute on function public.notify_comment_mentions(bigint, uuid[], text) to authenticated, service_role;
