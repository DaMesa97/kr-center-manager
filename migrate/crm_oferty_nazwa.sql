-- CRM: własny tytuł oferty (Tymek 21.11: „są inwestorzy, dla których prowadzimy kilka ofert równolegle”).
-- crm.oferty.nazwa — dowolny tekst nadany przez handlowca; pusta = aplikacja podpowiada nazwę z produktu / streszczenia.
-- Nowa wersja oferty (przeliczenie z poprawką) to nowy wiersz z poprzednia_id — wyzwalacz przepisuje nazwę,
-- żeby nie ginęła po każdej poprawce. Zmiana nazwy nie rusza statusu, więc nie odpala przeliczenia ani wysyłki.

alter table crm.oferty add column if not exists nazwa text;

comment on column crm.oferty.nazwa is 'Tytuł oferty nadany przez handlowca (np. „Budynek W1 — drzwi do mieszkań”); null = podpowiedź w aplikacji';

create or replace function crm.oferty_nazwa_z_poprzedniej()
returns trigger
language plpgsql
set search_path = crm, public
as $$
begin
  if new.nazwa is null and new.poprzednia_id is not null then
    select p.nazwa into new.nazwa from crm.oferty p where p.id = new.poprzednia_id;
  end if;
  return new;
end
$$;

drop trigger if exists oferty_nazwa_z_poprzedniej on crm.oferty;
create trigger oferty_nazwa_z_poprzedniej
  before insert on crm.oferty
  for each row execute function crm.oferty_nazwa_z_poprzedniej();
