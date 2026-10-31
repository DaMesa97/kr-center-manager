-- =====================================================================
-- BASTION — KOLEKCJA z prefiksu modelu (2026-10-31)
--
-- Kolumna bastion_collection była: pusta dla zleceń z bota (714) albo wypełniona
-- SYSTEMEM przez import z Excela (BASIC, BASIC PLUS, BOLD…). Kolekcja w arkuszu
-- Bastion to STANDARD / ALU / NOWOCZESNE / TRADYCYJNE / LUX / LACOBEL, liczona
-- przez makro z dwóch pierwszych znaków modelu. Tu to samo, w bazie:
--   A- → ALU, B- → ALU BLACK, P- → ALU PATINA, R- → ALU RADIUS, N- → NOWOCZESNE,
--   T- → TRADYCYJNE, ST → STANDARD, LA / L- → LACOBEL, LU → LUX, inne → brak.
-- Trigger wylicza kolekcję przy INSERT i przy zmianie modelu; ręczna kolekcja
-- zostaje tylko wtedy, gdy z modelu nic nie wynika (i nie jest nazwą systemu).
-- Bezpieczne do ponownego uruchomienia.
-- =====================================================================

create or replace function public.bastion_collection_for_model(p_model text)
returns text
language sql
immutable
as $function$
  select case upper(left(trim(coalesce(p_model, '')), 2))
    when 'A-' then 'ALU'
    when 'B-' then 'ALU BLACK'
    when 'P-' then 'ALU PATINA'
    when 'R-' then 'ALU RADIUS'
    when 'N-' then 'NOWOCZESNE'
    when 'T-' then 'TRADYCYJNE'
    when 'ST' then 'STANDARD'
    when 'LA' then 'LACOBEL'
    when 'L-' then 'LACOBEL'
    when 'LU' then 'LUX'
    else null
  end;
$function$;

-- wartości, które w tej kolumnie są systemem (pozostałość importu z Excela), nie kolekcją
create or replace function public.bastion_collection_is_system_name(p_value text)
returns boolean
language sql
immutable
as $function$
  select upper(trim(coalesce(p_value, ''))) in
    ('BASIC', 'BASIC PLUS', 'BASIC LOCK PLUS', 'PREMIUM', 'PREMIUM RC2', 'BOLD', 'BOLD PLUS', 'SILENT');
$function$;

create or replace function public.bastion_set_collection()
returns trigger
language plpgsql
as $function$
declare
  v_derived text;
begin
  if new.category <> 'Bastion' then
    return new;
  end if;
  v_derived := public.bastion_collection_for_model(new.model);
  if tg_op = 'INSERT' or new.model is distinct from old.model or coalesce(new.bastion_collection, '') = ''
     or public.bastion_collection_is_system_name(new.bastion_collection) then
    if v_derived is not null then
      new.bastion_collection := v_derived;
    elsif public.bastion_collection_is_system_name(new.bastion_collection) then
      new.bastion_collection := null;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_bastion_set_collection on public.orders;
create trigger trg_bastion_set_collection
  before insert or update of model, bastion_collection, category on public.orders
  for each row execute function public.bastion_set_collection();

-- słownik kolekcji w formularzu Bastion (był tylko ALU)
insert into public.config_options (category, type, value, sort_order)
select 'Bastion', 'kolekcja', v.value, v.ord
from (values ('STANDARD', 1), ('ALU', 2), ('ALU BLACK', 3), ('ALU PATINA', 4), ('ALU RADIUS', 5),
             ('NOWOCZESNE', 6), ('TRADYCYJNE', 7), ('LUX', 8), ('LACOBEL', 9)) as v(value, ord)
where not exists (select 1 from public.config_options c where c.category = 'Bastion' and c.type = 'kolekcja' and upper(c.value) = v.value);
update public.config_options c set sort_order = v.ord
from (values ('STANDARD', 1), ('ALU', 2), ('ALU BLACK', 3), ('ALU PATINA', 4), ('ALU RADIUS', 5),
             ('NOWOCZESNE', 6), ('TRADYCYJNE', 7), ('LUX', 8), ('LACOBEL', 9)) as v(value, ord)
where c.category = 'Bastion' and c.type = 'kolekcja' and upper(c.value) = v.value;

-- przepisanie istniejących zleceń Bastion (z Excela: system → kolekcja; z bota: puste → kolekcja)
update public.orders o
set bastion_collection = coalesce(public.bastion_collection_for_model(o.model),
                                  case when public.bastion_collection_is_system_name(o.bastion_collection) then null else o.bastion_collection end)
where o.category = 'Bastion'
  and (coalesce(o.bastion_collection, '') = ''
       or public.bastion_collection_is_system_name(o.bastion_collection)
       or o.bastion_collection is distinct from public.bastion_collection_for_model(o.model));

select coalesce(bastion_collection, '∅') as kolekcja, count(*) from public.orders where category = 'Bastion' group by 1 order by 2 desc;
