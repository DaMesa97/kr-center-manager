-- 27.11.2026 (testy 27.11, runda 3; WYSOKI): admin (nie superadmin) mógł bezpośrednim update profiles zmienić rolę /
-- kategorie konta z wpisem w crm.dostep (konto CRM Po Drzwi) albo skasować jego profil. Konta CRM ma prowadzić tylko
-- superadmin — Edge manage-users egzekwuje to już przy resecie hasła / blokadzie / usunięciu, baza nie.
-- Teraz trigger protect_superadmin_role (BEFORE INSERT/UPDATE/DELETE na profiles, SECURITY DEFINER — widzi crm.dostep
-- bez RLS) dodatkowo: zmiana roli lub kategorii albo usunięcie profilu konta z wpisem w crm.dostep tylko dla
-- superadmina. Bez zmian dla: konta serwisowego (service_role), wywołań bez JWT (postgres, usuwanie konta przez
-- GoTrue / manage-users), zmian innych pól (np. własne imię), kont bez wpisu w crm.dostep.
-- DO WDROŻENIA (nie wgrane w sesji).
do $$
declare
  d text;
  stare text := 'begin
  if tg_op = ''DELETE'' then';
  nowe text := 'begin
  -- konta CRM Po Drzwi (wpis w crm.dostep): rolę, kategorie i usunięcie zmienia tylko superadmin (testy 27.11 (runda 3), CRM)
  if tg_op in (''UPDATE'', ''DELETE'')
     and auth.uid() is not null
     and coalesce(auth.role(), '''') <> ''service_role''
     and not public.current_user_is_superadmin()
     and exists (select 1 from crm.dostep cd where cd.user_id = old.id) then
    if tg_op = ''DELETE'' then
      raise exception ''To konto ma dostęp do CRM Po Drzwi — usunąć je może tylko superadministrator.'' using errcode = ''42501'';
    end if;
    if old.role is distinct from new.role or old.categories is distinct from new.categories then
      raise exception ''To konto ma dostęp do CRM Po Drzwi — rolę i kategorie zmienia tylko superadministrator.'' using errcode = ''42501'';
    end if;
  end if;

  if tg_op = ''DELETE'' then';
begin
  d := pg_get_functiondef('public.protect_superadmin_role()'::regprocedure);
  if position('testy 27.11 (runda 3), CRM' in d) > 0 then
    raise notice 'protect_superadmin_role: już poprawione — bez zmian';
    return;
  end if;
  if position(stare in d) = 0 then
    raise exception 'protect_superadmin_role: nie znaleziono miejsca łatki — sprawdź definicję';
  end if;
  execute replace(d, stare, nowe);
end $$;
