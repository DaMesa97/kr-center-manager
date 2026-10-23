-- Aluminium (23.10): zmniejszenie ilości pozycji zawsze przycina odklikane sztuki.
-- „Nowa wersja LP” robiła to już przez alu_trim_stages, ale każda inna zmiana
-- ilości (ręcznie w bazie) zostawiała done > ilość → pierwszy „Cofnij” zdejmował
-- niewidoczną sztukę i na ekranie nic się nie działo.

create or replace function public.alu_positions_trim_on_quantity()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.production_stages := public.alu_trim_stages(new.production_stages, new.quantity);
  return new;
end;
$function$;

drop trigger if exists alu_positions_trim_on_quantity on public.order_alu_positions;
create trigger alu_positions_trim_on_quantity
  before update of quantity on public.order_alu_positions
  for each row
  when (new.quantity < old.quantity)
  execute function public.alu_positions_trim_on_quantity();

-- jednorazowo: istniejące pozycje z done > ilość
update public.order_alu_positions
set production_stages = public.alu_trim_stages(production_stages, quantity)
where production_stages is distinct from public.alu_trim_stages(production_stages, quantity);
