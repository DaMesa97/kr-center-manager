-- 28.11.2026 — decyzja D12 (właściciel: TAK): ceny z konfiguratora nie docierają do pracowników hali i magazynu.
-- Było: orders.configurator_value (3782 zlecenia), orders.extra_fields.raw_payload.wartoscKonfigurator (1818, kopia
-- zgłoszenia z bota) i complaints.configurator_value (379) — wszystkie czytelne dla każdego zalogowanego
-- (orders_read / complaints_read: authenticated); ekran tylko ukrywał wartość, F12 pokazywał ceny.
-- (complaints.configurator_value to text not null default '': 3 wartości liczbowe, 376 pustych napisów —
-- tam po przeniesieniu zostaje pusty napis.)
-- orders_archive i audit_log czyta już tylko kierownik — bez zmian.
-- Wybrane rozwiązanie (najmniej ryzykowne): ceny przenosimy do osobnej tabeli public.ceny_konfiguratora z RLS
-- „tylko kierownicy” (current_user_is_manager: admin, superadmin, manager, kierownik_*). Kolumny w orders /
-- complaints ZOSTAJĄ (zawsze puste), więc `select *` w aplikacji, realtime, archiwizacja i przywracanie działają
-- bez zmian — odebranie SELECT kolumny wywróciłoby każde `select('*')` na orders (kilkadziesiąt miejsc).
--  1) tabela ceny_konfiguratora (tabela, rekord_id) — bez klucza obcego, żeby cena przetrwała archiwizację
--     (zlecenie w orders_archive ma to samo id); zapis tylko przez trigger (SECURITY DEFINER) / konto serwisowe.
--  2) trigger BEFORE INSERT / UPDATE na orders i complaints: niepusta cena (i wartoscKonfigurator z raw_payload)
--     → do ceny_konfiguratora, w wierszu zostaje null / klucz usunięty. Działa dla create_bot_order (bot),
--     formularzy aplikacji (stara wersja wysyła cenę — trafia do tabeli), restore_from_archive, reklamacji.
--     Zapis null nie kasuje ceny w tabeli.
--  3) create_bot_order: wykrywanie identycznego zgłoszenia porównywało raw_payload bez recordId — po usunięciu
--     wartoscKonfigurator z zapisanych zgłoszeń porównanie pomija też ten klucz (z obu stron).
--  4) przeniesienie istniejących cen + wyczyszczenie kolumn / klucza (≈3782 zleceń, 379 reklamacji; trigger audytu
--     zapisze zmianę w audit_log — czyta go tylko kierownik).
-- Aplikacja: nie pokazuje ceny pracownikom; Archiwum (kierownik) bierze cenę z ceny_konfiguratora, gdy kolumna
-- pusta (src/lib/cenyKonfiguratora.ts). Działa przed i po migracji.
-- Pytanie do właściciela: obsługa klienta (rola obsluga_klienta) po migracji też nie widzi cen — jeśli ma widzieć,
-- dopisać rolę do polityki ceny_konfiguratora_select.
-- DO WDROŻENIA (nie wgrane). Samodzielny. Kolejność dowolna: stara aplikacja po migracji działa (w Archiwum pokaże
-- „—” zamiast ceny), nowa aplikacja przed migracją czyta cenę z kolumny jak dotąd.
-- Test w transakcji cofanej 28.11: 4 s, 3782 ceny zleceń + 3 reklamacji przeniesione (suma zgodna), pracownik
-- produkcji: 0 wierszy cen, kierownik działu: wszystkie; bot: nowe zlecenie bez ceny w wierszu, duplikat wykryty.

-- 1) tabela cen
create table if not exists public.ceny_konfiguratora (
  tabela text not null check (tabela in ('orders', 'complaints')),
  rekord_id bigint not null,
  configurator_value text,  -- tekst: orders ma numeric, complaints text
  wartosc_z_bota jsonb,
  zmieniono timestamptz not null default now(),
  primary key (tabela, rekord_id)
);

comment on table public.ceny_konfiguratora is
  'D12: ceny z konfiguratora (orders / complaints) — tylko dla kierowników; w orders.configurator_value zawsze null';

alter table public.ceny_konfiguratora enable row level security;
revoke all on public.ceny_konfiguratora from public, anon, authenticated;
grant select on public.ceny_konfiguratora to authenticated;
grant all on public.ceny_konfiguratora to service_role;

drop policy if exists ceny_konfiguratora_select on public.ceny_konfiguratora;
create policy ceny_konfiguratora_select on public.ceny_konfiguratora
  for select to authenticated
  using ((select public.current_user_is_manager()));

-- 2) przenoszenie ceny przy zapisie
create or replace function public.ceny_konfiguratora_przenies()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_val text := nullif(btrim(new.configurator_value::text), '');
  v_bot jsonb := case when jsonb_typeof(new.extra_fields->'raw_payload') = 'object'
                      then new.extra_fields->'raw_payload'->'wartoscKonfigurator' end;
begin
  -- D12: cena tylko w ceny_konfiguratora (RLS: kierownicy); w wierszu zostaje null
  if v_val is not null or v_bot is not null then
    insert into ceny_konfiguratora as c (tabela, rekord_id, configurator_value, wartosc_z_bota, zmieniono)
    values (tg_table_name, new.id, v_val, v_bot, now())
    on conflict (tabela, rekord_id) do update
      set configurator_value = coalesce(excluded.configurator_value, c.configurator_value),
          wartosc_z_bota = coalesce(excluded.wartosc_z_bota, c.wartosc_z_bota),
          zmieniono = now();
    if v_val is not null then
      -- complaints.configurator_value: text not null default '' — tam pusty napis
      if tg_table_name = 'complaints' then
        new.configurator_value := '';
      else
        new.configurator_value := null;
      end if;
    end if;
    if v_bot is not null then
      new.extra_fields := new.extra_fields #- '{raw_payload,wartoscKonfigurator}';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.ceny_konfiguratora_przenies() from public, anon, authenticated;

drop trigger if exists trg_ceny_konfiguratora on public.orders;
create trigger trg_ceny_konfiguratora
  before insert or update of configurator_value, extra_fields on public.orders
  for each row
  when (new.configurator_value is not null or (new.extra_fields->'raw_payload') ? 'wartoscKonfigurator')
  execute function public.ceny_konfiguratora_przenies();

drop trigger if exists trg_ceny_konfiguratora on public.complaints;
create trigger trg_ceny_konfiguratora
  before insert or update of configurator_value, extra_fields on public.complaints
  for each row
  when (nullif(btrim(new.configurator_value), '') is not null or (new.extra_fields->'raw_payload') ? 'wartoscKonfigurator')
  execute function public.ceny_konfiguratora_przenies();

-- 3) create_bot_order: porównanie zgłoszeń bez wartoscKonfigurator
do $$
declare
  d text;
  stare text := '(o.extra_fields->''raw_payload'') - ''recordId'' = (p_payload - ''recordId'')';
  nowe text := '(o.extra_fields->''raw_payload'') - ''recordId'' - ''wartoscKonfigurator'' = (p_payload - ''recordId'' - ''wartoscKonfigurator'')';
begin
  d := pg_get_functiondef('public.create_bot_order(jsonb,bigint,jsonb)'::regprocedure);
  if position('''wartoscKonfigurator'' = (p_payload' in d) > 0 then
    raise notice 'create_bot_order: już poprawione — bez zmian';
    return;
  end if;
  if position(stare in d) = 0 then
    raise exception 'create_bot_order: nie znaleziono miejsca łatki — sprawdź definicję';
  end if;
  execute replace(d, stare, nowe);
end $$;

-- 4) istniejące ceny → tabela, w wierszach puste
insert into public.ceny_konfiguratora as c (tabela, rekord_id, configurator_value, wartosc_z_bota)
select 'orders', o.id, o.configurator_value::text,
       case when jsonb_typeof(o.extra_fields->'raw_payload') = 'object' then o.extra_fields->'raw_payload'->'wartoscKonfigurator' end
from public.orders o
where o.configurator_value is not null or (o.extra_fields->'raw_payload') ? 'wartoscKonfigurator'
on conflict (tabela, rekord_id) do update
  set configurator_value = coalesce(excluded.configurator_value, c.configurator_value),
      wartosc_z_bota = coalesce(excluded.wartosc_z_bota, c.wartosc_z_bota);

insert into public.ceny_konfiguratora as c (tabela, rekord_id, configurator_value)
select 'complaints', r.id, btrim(r.configurator_value)
from public.complaints r
where nullif(btrim(r.configurator_value), '') is not null
on conflict (tabela, rekord_id) do update
  set configurator_value = coalesce(excluded.configurator_value, c.configurator_value);

-- czyszczenie wierszy (trigger z pkt 2 tu nie odpala — nowy wiersz jest już bez ceny)
update public.orders
set configurator_value = null,
    extra_fields = extra_fields #- '{raw_payload,wartoscKonfigurator}'
where configurator_value is not null or (extra_fields->'raw_payload') ? 'wartoscKonfigurator';

update public.complaints
set configurator_value = ''
where nullif(btrim(configurator_value), '') is not null;
