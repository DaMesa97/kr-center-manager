-- 28.11.2026 (testy 27.11 (runda 3) — noc 28.11; ŚREDNI): pliki w storage.
-- 1) Polityki SELECT order_photos_read i feedback_attachments_read (rola public = także anon) pozwalały bez logowania
--    wylistować wszystkie pliki z bucketów order-photos i feedback-attachments (nazwy ścieżek, metadane).
--    Oba buckety są PUBLICZNE (storage.buckets.public = true), a aplikacja pokazuje pliki przez getPublicUrl
--    (OrderPhotos, MobilePackingView, feedbackAttachments) — publiczny URL działa bez żadnej polityki SELECT.
--    Aplikacja nie używa list()/download(). SELECT jest potrzebny tylko przy remove() (Storage wymaga SELECT + DELETE):
--    zdjęcia usuwa kierownik (order_photos_delete), załączniki zgłoszeń — autor albo kierownik
--    (feedback_attachments_delete). Dlatego SELECT: tylko zalogowani, i tylko własne pliki albo kierownik.
-- 2) Tabela order_photos: polityka order_photos_insert miała WITH CHECK (true) — można było wstawić zdjęcie
--    „w imieniu” innej osoby. Aplikacja zawsze wysyła uploaded_by = id zalogowanego (OrderPhotos: currentUser.id,
--    MobilePackingView: user.id), więc wymuszamy uploaded_by = auth.uid().
--    Przywracanie z archiwum (restore_from_archive__impl, SECURITY DEFINER, właściciel tabeli) RLS nie podlega.
-- DO WDROŻENIA (nie wgrane w sesji).

drop policy if exists order_photos_read on storage.objects;
create policy order_photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'order-photos' and (owner = auth.uid() or public.current_user_is_manager()));

drop policy if exists feedback_attachments_read on storage.objects;
create policy feedback_attachments_read on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback-attachments' and (owner = auth.uid() or public.current_user_is_manager()));

drop policy if exists order_photos_insert on public.order_photos;
create policy order_photos_insert on public.order_photos
  for insert to authenticated
  with check (uploaded_by = (select auth.uid()));
