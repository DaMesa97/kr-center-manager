-- 28.11.2026 (D19 — TAK): odstąpienie od podpisanej umowy. Pełna treść 20261127233500 z wyjątkiem dla rpc
-- crm.odstap_od_umowy — osobny plik, bo 20261127233500 WGRANO na produkcję 28.11 w pakiecie (wersja bez odstąpienia).
-- Można uruchamiać wielokrotnie (create or replace + drop/create trigger).
-- 27.11.2026 (testy 27.11, runda 3; ŚREDNI): podpisana albo anulowana umowa (crm.dokumenty, rodzaj 'umowa') dawała się
-- cofnąć do innego statusu albo zmienić jej numer (bezpośredni zapis przez API — RLS pozwala aplikacji zmieniać status).
-- Teraz trigger BEFORE UPDATE odrzuca (P0411, komunikat po polsku):
--   * zmianę statusu umowy, która jest 'podpisana' albo 'anulowana' (to statusy końcowe; aplikacja i tak nie pokazuje
--     dla nich przycisków zmiany — CrmView), także podpisana → anulowana (taka zmiana to decyzja właściciela; dziś nie
--     ma jej w aplikacji, więc blokada niczego nie psuje),
--   * zmianę numeru takiej umowy.
-- Przejście DO 'podpisana' / 'anulowana' (np. przyszły podpis z Autenti: wyslana → podpisana) działa jak dotąd.
-- Sprawdzone 27.11: Edge crm-dokumenty (repo) aktualizuje wiersz tylko przy regeneracji (numer, dane, plik_pdf,
-- oferta_id) i sama odmawia dla podpisanej / anulowanej umowy; aplikacja (useCrm.ts) zmienia tylko status; funkcje SQL
-- nie aktualizują crm.dokumenty. Dziś w tabeli są 2 wiersze, oba 'blankiet'.
-- Poprawka 28.11.2026 (decyzja właściciela D19 — TAK): odstąpienie od podpisanej umowy. Jedyne dozwolone przejście
-- z zamkniętej umowy to „podpisana → anulowana”, i tylko przez rpc crm.odstap_od_umowy(dokument, powód): sprawdza
-- dostęp do CRM, wymaga powodu, zapisuje go w dane.odstapienie umowy i w historii klienta (zdarzenie
-- 'umowa_odstapienie'); aplikacja pyta o potwierdzenie i powód (przycisk „Odstąpienie od umowy”). Bezpośredni zapis
-- przez API (PATCH status) dalej jest odrzucany — trigger przepuszcza tylko zmianę z flagą transakcji ustawioną przez rpc.
-- Numer anulowanej umowy nie wraca do użycia (crm-dokumenty). Status klienta się nie zmienia (decyzja handlowca).
-- DO WDROŻENIA (nie wgrane).
create or replace function crm.dokumenty_umowa_zamknieta()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  -- testy 27.11 (runda 3): podpisana / anulowana umowa jest zamknięta
  if old.rodzaj = 'umowa' and old.status in ('podpisana', 'anulowana') then
    -- D19 (28.11): odstąpienie od podpisanej umowy — tylko przez rpc crm.odstap_od_umowy (flaga transakcji)
    if old.status = 'podpisana' and new.status = 'anulowana' and new.numer is not distinct from old.numer
       and coalesce(current_setting('crm.odstapienie_umowy', true), '') = old.id::text then
      return new;
    end if;
    if new.status is distinct from old.status then
      raise exception 'Umowa nr % jest już %. Nie można zmienić jej statusu — w razie potrzeby przygotuj nową umowę (odstąpienie od podpisanej: przycisk „Odstąpienie od umowy”).',
        coalesce(old.numer, '?'), old.status using errcode = 'P0411';
    end if;
    if new.numer is distinct from old.numer then
      raise exception 'Umowa nr % jest już %. Nie można zmienić jej numeru.',
        coalesce(old.numer, '?'), old.status using errcode = 'P0411';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function crm.dokumenty_umowa_zamknieta() from public, anon, authenticated;

drop trigger if exists dokumenty_umowa_zamknieta on crm.dokumenty;
create trigger dokumenty_umowa_zamknieta
  before update on crm.dokumenty
  for each row
  execute function crm.dokumenty_umowa_zamknieta();

-- D19 (28.11): odstąpienie od podpisanej umowy z powodem w historii klienta
create or replace function crm.odstap_od_umowy(p_dokument_id uuid, p_powod text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  d crm.dokumenty;
  powod text := nullif(btrim(coalesce(p_powod, '')), '');
begin
  if uid is null or not public.current_user_has_crm() then
    raise exception 'Brak dostępu do CRM' using errcode = '42501';
  end if;
  if powod is null or char_length(powod) < 3 then
    raise exception 'Wpisz powód odstąpienia od umowy (np. „klient odstąpił w terminie 14 dni”).' using errcode = 'P0412';
  end if;
  select * into d from crm.dokumenty where id = p_dokument_id for update;
  if not found then
    raise exception 'Nie ma takiej umowy' using errcode = 'P0412';
  end if;
  if d.rodzaj <> 'umowa' then
    raise exception 'Odstąpienie dotyczy tylko umowy' using errcode = 'P0412';
  end if;
  if d.status = 'anulowana' then
    return jsonb_build_object('ok', true, 'status', 'anulowana', 'juz', true);
  end if;
  if d.status <> 'podpisana' then
    raise exception 'Umowa nr % nie jest podpisana (status: %) — zmień status zwykłą listą.', coalesce(d.numer, '?'), d.status using errcode = 'P0412';
  end if;
  perform set_config('crm.odstapienie_umowy', d.id::text, true);
  update crm.dokumenty
     set status = 'anulowana',
         dane = coalesce(dane, '{}'::jsonb) || jsonb_build_object('odstapienie', jsonb_build_object('powod', left(powod, 500), 'kto', uid, 'kiedy', now()))
   where id = d.id;
  perform set_config('crm.odstapienie_umowy', '', true);
  insert into crm.zdarzenia (lead_id, oferta_id, typ, opis, kto, dane)
  values (d.lead_id, d.oferta_id, 'umowa_odstapienie',
    'Odstąpienie od umowy nr ' || coalesce(d.numer, '?') || ': ' || left(powod, 500) || '.', uid,
    jsonb_build_object('dokument_id', d.id, 'numer', d.numer, 'powod', left(powod, 500), 'zrodlo', 'klik'));
  return jsonb_build_object('ok', true, 'status', 'anulowana', 'juz', false);
end;
$function$;

revoke all on function crm.odstap_od_umowy(uuid, text) from public, anon;
grant execute on function crm.odstap_od_umowy(uuid, text) to authenticated;
