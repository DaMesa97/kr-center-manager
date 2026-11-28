-- 28.11.2026 — decyzja D29 (właściciel: TAK, opcja a): kolumna orders.updated_at + trigger. Aplikacja przed zapisem
-- formularza zlecenia porównuje updated_at z chwili otwarcia z bieżącym w bazie i ostrzega „ktoś zmienił zlecenie
-- w międzyczasie — odśwież” (dziś wysyłane są tylko zmienione pola; to samo pole zmienione przez dwie osoby —
-- wygrywa ostatni, bez ostrzeżenia).
--  1) orders.updated_at timestamptz not null default now(). Istniejące wiersze dostają czas wgrania migracji
--     (szybka wartość domyślna — bez przepisywania tabeli i BEZ update wszystkich wierszy, więc nie odpalają się
--     triggery audytu / szkła / Excela).
--  2) trigger BEFORE UPDATE trg_zzz_orders_updated_at (nazwa na „zzz” — w Postgresie triggery BEFORE idą
--     alfabetycznie, ten ma widzieć zmiany zrobione przez wcześniejsze): updated_at = now() tylko, gdy wiersz
--     naprawdę się zmienił (poza samym updated_at); pusty update zostawia poprzednią wartość. Ręcznie wpisanej
--     wartości nie da się podać (zawsze nadpisuje trigger).
--  3) orders_archive.updated_at (nullable) — archiwizacja / przywracanie kopiują wspólne kolumny (archive_old_orders__impl,
--     restore_from_archive__impl biorą przecięcie kolumn), więc data ostatniej zmiany przechodzi do archiwum i wraca.
-- Audyt (audit_trigger_fn) już pomija zmianę samego updated_at.
-- Aplikacja działa przed migracją (brak kolumny → bez porównania).
-- DO WDROŻENIA (nie wgrane).

alter table public.orders add column if not exists updated_at timestamptz not null default now();
alter table public.orders_archive add column if not exists updated_at timestamptz;

create or replace function public.orders_touch_updated_at()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  -- D29: znacznik ostatniej zmiany wiersza (do wykrywania konfliktu edycji w formularzu)
  if (to_jsonb(NEW) - 'updated_at') is distinct from (to_jsonb(OLD) - 'updated_at') then
    NEW.updated_at := now();
  else
    NEW.updated_at := OLD.updated_at;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_zzz_orders_updated_at on public.orders;
create trigger trg_zzz_orders_updated_at
  before update on public.orders
  for each row execute function public.orders_touch_updated_at();

comment on column public.orders.updated_at is
  'D29: czas ostatniej zmiany wiersza (trigger trg_zzz_orders_updated_at) — formularz zlecenia ostrzega o zmianie w międzyczasie';
