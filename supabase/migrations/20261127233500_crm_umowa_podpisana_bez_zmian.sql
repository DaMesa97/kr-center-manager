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
-- DO WDROŻENIA (nie wgrane w sesji).
create or replace function crm.dokumenty_umowa_zamknieta()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  -- testy 27.11 (runda 3): podpisana / anulowana umowa jest zamknięta
  if old.rodzaj = 'umowa' and old.status in ('podpisana', 'anulowana') then
    if new.status is distinct from old.status then
      raise exception 'Umowa nr % jest już %. Nie można zmienić jej statusu — w razie potrzeby przygotuj nową umowę.',
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
