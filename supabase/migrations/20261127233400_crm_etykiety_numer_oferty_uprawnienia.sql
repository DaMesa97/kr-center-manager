-- 27.11.2026 (testy 27.11, runda 3; ŚREDNI, bezpieczeństwo): dwie funkcje CRM (SECURITY DEFINER) nie sprawdzały
-- dostępu do CRM — zalogowany pracownik produkcji bez CRM mógł zmieniać etykiety klientów i przepalać numery ofert.
--  * crm.dodaj_etykiety: woła ją tylko Edge crm-call-ingest (klucz serwisowy; index.ts, mail.ts, notatka.ts),
--    aplikacja (src/) i inne funkcje SQL jej nie wołają (sprawdzone 27.11). Dodane sprawdzenie: konto serwisowe,
--    SQL bez kontekstu API (auth.role() pusty: cron, migracje) albo użytkownik z dostępem do CRM (public.current_user_has_crm()); inaczej błąd P0403.
--  * crm.nastepny_numer_oferty: wołają ją tylko Edge crm-oferta-pdf (klucz serwisowy; funkcja tylko w bazie, nie ma
--    jej w repo — sprawdzone przez get_edge_function) i crm.zlec_oferte_oficjalna (SECURITY DEFINER, właściciel
--    postgres). Aplikacja nie woła. Uprawnienia były domyślne (PUBLIC = każdy, także anon) → odbieramy public/anon/
--    authenticated, zostaje service_role.
-- DO WDROŻENIA (nie wgrane w sesji).
create or replace function crm.dodaj_etykiety(p_lead_id uuid, p_etykiety text[])
 returns text[]
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  obecne text[];
  wynik text[];
  e text;
  g text;
  jedna boolean;
begin
  -- testy 27.11 (runda 3): tylko system (Edge / SQL bez JWT) albo osoba z dostępem do CRM
  if auth.role() is not null and auth.role() <> 'service_role' and not coalesce(public.current_user_has_crm(), false) then
    raise exception 'Brak dostępu do CRM.' using errcode = 'P0403';
  end if;
  select etykiety into obecne from crm.leady where id = p_lead_id for update;
  if not found then raise exception 'Nie ma takiego leada.'; end if;
  wynik := coalesce(obecne, '{}');
  foreach e in array coalesce(p_etykiety, '{}') loop
    select grupa, jedna_na_grupe into g, jedna from crm.etykiety where slug = e and aktywna;
    if g is null then continue; end if;
    if e = any(wynik) then continue; end if;
    if jedna and exists (select 1 from unnest(wynik) w join crm.etykiety x on x.slug = w where x.grupa = g) then continue; end if;
    wynik := array_append(wynik, e);
  end loop;
  update crm.leady set etykiety = wynik where id = p_lead_id returning etykiety into wynik;
  return wynik;
end;
$function$;

revoke all on function crm.nastepny_numer_oferty(date) from public, anon, authenticated;
grant execute on function crm.nastepny_numer_oferty(date) to service_role;
