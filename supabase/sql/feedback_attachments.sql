-- beta.95 (#125, Łukasz 12.11.2026): edycja treści zgłoszenia przez autora
-- + zrzuty ekranu (bucket feedback-attachments, kolumna feedback.attachments).
-- Zastosowane w bazie 12.11.2026 jako migracja `feedback_attachments_and_edit`.

alter table public.feedback
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.feedback.attachments is
  'Zrzuty ekranu: [{path, url, name, size}] — pliki w bucket feedback-attachments';

-- Autor może poprawić treść i załączniki swojego zgłoszenia, dopóki nie jest
-- „zrobione"; kierownik — każde. Status zmienia nadal tylko kierownik (policy).
create or replace function public.feedback_update_own(
  p_id bigint,
  p_content text,
  p_attachments jsonb default null
) returns public.feedback
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.feedback;
begin
  select * into v_row from public.feedback where id = p_id for update;
  if not found then
    raise exception 'Zgłoszenie % nie istnieje', p_id using errcode = 'P0002';
  end if;
  if not (public.current_user_is_manager() or v_row.author_id = auth.uid()) then
    raise exception 'Edytować może tylko autor zgłoszenia albo kierownik' using errcode = '42501';
  end if;
  if v_row.status = 'zrobione' and not public.current_user_is_manager() then
    raise exception 'Zgłoszenie jest już zamknięte — nie można go edytować' using errcode = '42501';
  end if;
  if coalesce(trim(p_content), '') = '' then
    raise exception 'Treść zgłoszenia nie może być pusta' using errcode = '22023';
  end if;
  update public.feedback
     set content = trim(p_content),
         attachments = coalesce(p_attachments, attachments)
   where id = p_id
   returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.feedback_update_own(bigint, text, jsonb) to authenticated;

-- Bucket na zrzuty (publiczny odczyt jak order-photos; obrazki do 10 MB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-attachments', 'feedback-attachments', true, 10485760,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists feedback_attachments_read on storage.objects;
create policy feedback_attachments_read on storage.objects
  for select using (bucket_id = 'feedback-attachments');

drop policy if exists feedback_attachments_insert on storage.objects;
create policy feedback_attachments_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'feedback-attachments');

drop policy if exists feedback_attachments_delete on storage.objects;
create policy feedback_attachments_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'feedback-attachments' and (owner = auth.uid() or public.current_user_is_manager()));
