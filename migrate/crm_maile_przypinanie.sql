-- CRM: maile przypinają się do klienta także później (Tymek 21.11: „w MBT to nie jest pełna historia wiadomości”).
-- Przyczyna: mail dostawał lead_id tylko przy wczytaniu ze skrzynki; nasze wysłane odpowiedzi prawie nigdy
-- (22 z 23 „sierot”), a mail sprzed powstania klienta zostawał bez klienta na zawsze (MBT: odpowiedź Magdy
-- 18.11 07:27, klient powstał z odpowiedzi MBT godzinę później).
--
-- Zasady (tylko jednoznaczne: adres pasuje do dokładnie jednego klienta):
--   * nowy mail WYCHODZĄCY bez klienta → klient po adresie odbiorcy (do / dw);
--     przychodzące przypina dalej analiza maila (crm-call-ingest) — nie wchodzimy jej w drogę;
--   * nowy klient albo zmiana e-maila → dopinają się jego wcześniejsze maile bez klienta: wychodzące zawsze,
--     przychodzące tylko gdy klient nie jest „Przegrany” (przypięcie przychodzącego przywraca do gry —
--     wyzwalacz maile_przywroc_do_gry — a stary mail nie powinien tego robić);
--   * jednorazowo: to samo dla wszystkich istniejących klientów.

create or replace function crm.lead_po_adresach(p_adresy text[])
returns uuid
language sql
stable
set search_path = crm, public
as $$
  select case when count(distinct l.id) = 1 then min(l.id::text)::uuid end
  from crm.leady l
  where coalesce(trim(l.email), '') <> ''
    and lower(trim(l.email)) = any (select lower(trim(a)) from unnest(coalesce(p_adresy, '{}')) a)
$$;

create or replace function crm.maile_przypnij_wychodzacy()
returns trigger
language plpgsql
set search_path = crm, public
as $$
begin
  if new.lead_id is null and new.kierunek = 'wychodzacy' then
    new.lead_id := crm.lead_po_adresach(coalesce(new.do_adresy, '{}') || coalesce(new.cc_adresy, '{}'));
  end if;
  return new;
end
$$;

drop trigger if exists maile_przypnij_wychodzacy on crm.maile;
create trigger maile_przypnij_wychodzacy
  before insert on crm.maile
  for each row execute function crm.maile_przypnij_wychodzacy();

create or replace function crm.leady_dopnij_maile()
returns trigger
language plpgsql
set search_path = crm, public
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
begin
  if v_email = '' then return new; end if;
  if tg_op = 'UPDATE' and lower(trim(coalesce(old.email, ''))) = v_email then return new; end if;
  -- adres musi należeć tylko do tego klienta
  if exists (select 1 from crm.leady l where l.id <> new.id and lower(trim(coalesce(l.email, ''))) = v_email) then return new; end if;
  update crm.maile m
     set lead_id = new.id
   where m.lead_id is null
     and (
       (m.kierunek = 'wychodzacy'
         and v_email = any (select lower(trim(a)) from unnest(coalesce(m.do_adresy, '{}') || coalesce(m.cc_adresy, '{}')) a))
       or (m.kierunek = 'przychodzacy' and lower(trim(coalesce(m.od_adres, ''))) = v_email and new.status is distinct from 'przegrany')
     );
  return new;
end
$$;

drop trigger if exists leady_dopnij_maile on crm.leady;
create trigger leady_dopnij_maile
  after insert or update of email on crm.leady
  for each row execute function crm.leady_dopnij_maile();

-- jednorazowo: istniejące „sieroty” (wychodzące po odbiorcy, przychodzące po nadawcy, klient jednoznaczny i nie przegrany)
update crm.maile m
   set lead_id = crm.lead_po_adresach(coalesce(m.do_adresy, '{}') || coalesce(m.cc_adresy, '{}'))
 where m.lead_id is null and m.kierunek = 'wychodzacy'
   and crm.lead_po_adresach(coalesce(m.do_adresy, '{}') || coalesce(m.cc_adresy, '{}')) is not null;

update crm.maile m
   set lead_id = x.lead_id
  from (select m2.id, crm.lead_po_adresach(array[m2.od_adres]) lead_id from crm.maile m2 where m2.lead_id is null and m2.kierunek = 'przychodzacy') x
  join crm.leady l on l.id = x.lead_id
 where m.id = x.id and x.lead_id is not null and l.status is distinct from 'przegrany';
