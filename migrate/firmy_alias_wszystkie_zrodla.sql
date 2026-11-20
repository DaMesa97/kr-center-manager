-- =====================================================================
-- Aliasy firm „raz na dobre” (Tymek 20.11.2026)
--
-- Dotąd trigger trg_apply_company_alias podmieniał nazwę firmy TYLKO przy zleceniu z bota
-- (source = 'bot') i tylko przy dokładnym lower(trim). Zlecenia z Excela wchodziły z nazwą
-- z arkusza („PO DRZWI ŻORY”), z konfiguratora z inną („PO DRZWI”) — stąd warianty.
--
-- Teraz: każdy INSERT do orders (bot, Excel, API, ręcznie) przechodzi przez aliasy, a bez aliasu
-- przez listę kontrahentów (companies.name — „KARMON ŻORY” z arkusza → „KARMON Żory” z listy),
-- a porównanie idzie po company_key() — tym samym kluczu co lib/companyStats.ts
-- (wielkie litery bez ogonków, bez „#” i interpunkcji, bez powtórzonego słowa).
-- Klucz trzymamy w kolumnach companies.name_key / company_aliases.alias_key (trigger + indeks),
-- żeby wstawienie zlecenia było jednym trafieniem w indeks, nie 3000 wywołań funkcji.
-- Oryginalną nazwę zapisujemy w extra_fields.company_as_received (nic nie ginie).
-- Istniejących zleceń NIE przepisujemy — statystyki i tak liczą warianty razem.
-- =====================================================================

-- Klucz porównawczy nazwy firmy (lustro companyKey z lib/companyStats.ts)
create or replace function public.company_key(p text)
returns text
language plpgsql
stable
set search_path = public, extensions  -- unaccent mieszka w extensions; trigger ma własny search_path
as $$
declare
  v text;
  t text;
  prev text := null;
  out_tokens text[] := '{}';
begin
  v := upper(unaccent(translate(coalesce(p, ''), 'łŁ', 'lL')));
  v := btrim(regexp_replace(v, '[^A-Z0-9]+', ' ', 'g'));
  if v = '' then return ''; end if;
  foreach t in array string_to_array(v, ' ') loop
    if t <> '' and (prev is null or prev <> t) then
      out_tokens := out_tokens || t;
    end if;
    prev := t;
  end loop;
  return array_to_string(out_tokens, ' ');
end;
$$;

comment on function public.company_key(text) is 'Klucz porównawczy nazwy firmy: lustro companyKey() z lib/companyStats.ts (aliasy firm, statystyki)';

-- ── klucz w kolumnie: companies.name_key ───────────────────────────────────────────────────
alter table public.companies add column if not exists name_key text;

create or replace function public.companies_set_name_key()
returns trigger
language plpgsql
as $$
begin
  new.name_key := public.company_key(new.name);
  return new;
end;
$$;

drop trigger if exists trg_companies_name_key on public.companies;
create trigger trg_companies_name_key
  before insert or update of name on public.companies
  for each row execute function public.companies_set_name_key();

update public.companies set name_key = public.company_key(name) where name_key is distinct from public.company_key(name);
create index if not exists idx_companies_name_key on public.companies (name_key);

-- ── klucz w kolumnie: company_aliases.alias_key ────────────────────────────────────────────
alter table public.company_aliases add column if not exists alias_key text;

create or replace function public.company_aliases_set_key()
returns trigger
language plpgsql
as $$
begin
  new.alias_key := public.company_key(new.alias_name);
  return new;
end;
$$;

drop trigger if exists trg_company_aliases_key on public.company_aliases;
create trigger trg_company_aliases_key
  before insert or update of alias_name on public.company_aliases
  for each row execute function public.company_aliases_set_key();

update public.company_aliases set alias_key = public.company_key(alias_name) where alias_key is distinct from public.company_key(alias_name);
create index if not exists idx_company_aliases_key on public.company_aliases (alias_key);

-- ── podmiana nazwy przy INSERT do orders ──────────────────────────────────────────────────
-- 1) alias kierownika (company_aliases), 2) kontrahent z listy companies o tym samym kluczu
-- — każde źródło (bot, Excel, API, ręcznie), porównanie po company_key
create or replace function public.apply_company_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_key text;
begin
  if new.company is null or btrim(new.company) = '' then
    return new;
  end if;
  v_key := public.company_key(new.company);
  if v_key = '' then
    return new;
  end if;
  select ca.company_name into v_name
    from public.company_aliases ca
   where ca.alias_key = v_key
   order by ca.id
   limit 1;
  -- bez aliasu: kontrahent z listy (Ustawienia → Kontrahenci) o tym samym kluczu → jego pisownia
  if v_name is null then
    select c.name into v_name
      from public.companies c
     where c.name_key = v_key
     order by c.id
     limit 1;
  end if;
  if v_name is not null and v_name <> new.company then
    new.extra_fields := coalesce(new.extra_fields, '{}'::jsonb) || jsonb_build_object('company_as_received', new.company);
    new.company := v_name;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apply_company_alias on public.orders;
create trigger trg_apply_company_alias
  before insert on public.orders
  for each row execute function public.apply_company_alias();
