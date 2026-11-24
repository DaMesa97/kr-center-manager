-- 2026-11-24 (Tymek, po #168): „ustaw wszystkie minima w utworzonych już towarach na 1, ręcznie sobie poustawiam” oraz
-- „ustaw też nowym komponentom domyślnie 1”. Istniejące 484 komponenty dostały order_multiple = 1 jednorazowym update'em;
-- nowe startują z 1 (default + trigger na insert, bo aplikacja wysyła kolumnę wprost). „Jak paleta” zostaje tylko dla
-- komponentu, któremu ktoś świadomie wyczyści pole przy edycji. Zastosowane konektorem jako komponenty_minimum_logistyczne_domyslne.

-- jednorazowo (wykonane 24.11 osobnym zapytaniem): update public.warehouse_components set order_multiple = 1 where order_multiple is null;

alter table public.warehouse_components alter column order_multiple set default 1;

create or replace function public.warehouse_components_order_multiple_default()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.order_multiple is null then new.order_multiple := 1; end if;
  return new;
end;
$$;

drop trigger if exists trg_warehouse_components_order_multiple_default on public.warehouse_components;
create trigger trg_warehouse_components_order_multiple_default
  before insert on public.warehouse_components
  for each row execute function public.warehouse_components_order_multiple_default();

comment on column public.warehouse_components.order_multiple is
  'Minimum logistyczne: wielokrotność, w jakiej dostawca sprzedaje ten komponent (np. 8 albo 12 szt.). Nowy komponent = 1 (sztuki); puste przy edycji = jak sztuki na palecie. Zaokrągla w górę DO ZAMÓWIENIA i sugestie zamówień (#168).';
