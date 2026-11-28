-- 28.11.2026 — decyzja D17, doprecyzowanie właściciela: „WYGRANY Z WARTOŚCIĄ ZAMÓWIENIA Z MAILA, OFERTY NIE ISTOTNE”.
-- Było (pliki 20261128033000 — WGRANY — i wcześniejsza zasada z maila sklepu):
--   * wartość klienta (crm.leady.wartosc_szac) = kwota zamówienia TYLKO gdy była pusta — np. klient z ręcznie wpisaną
--     szacunkową wartością 6000 zł po zamówieniu za 5867 zł dalej miał 6000; klient z dwoma zamówieniami miał kwotę
--     pierwszego;
--   * „Zamówił” z maila sklepu (crm.zamowienie_sklepowe_wygrany) szło przez crm.oznacz_wynik, które AKCEPTUJE najnowszą
--     wysłaną ofertę — a oferty przy zamówieniu ze sklepu nie mają znaczenia.
-- Teraz:
--  1) crm.wartosc_klienta_ze_sklepu(klient, źródło, bl_id): wartość klienta = SUMA kwot wszystkich POTWIERDZONYCH zamówień
--     sklepowych klienta (crm.zamowienia_sklep, kwota > 0, PLN) — NADPISUJE wpis ręczny / z oferty. Suma, nie ostatnie
--     zamówienie: klient, który zamówił dwa razy, jest wart tyle, ile zapłacił łącznie (28.11: 1 taki klient). Kwota
--     z Baselinkera = to, co klient płaci (z dostawą) — pewniejsza niż „razem” z maila, które AI czasem czyta bez
--     dostawy (28.11: mail 2204 zł, zamówienie 2504 zł z dostawą 300 zł). Zmiana → zdarzenie 'wartosc_zmieniona'
--     (dane.zrodlo = 'baselinker' / 'mail_sklepu') — widać w historii klienta, kto/co zmienił wartość.
--     Anulowane w Baselinkerze (potwierdzone → false) nie jest odejmowane — anulowanie nie cofa „Zamówił” (bez zmian),
--     wartość też zostaje.
--  2) crm.zamowienie_bl_wygrany: po oznaczeniu „Zamówił” (albo gdy już był „wygrany”) ustawia wartość z pkt 1.
--     Klient „przegrany” przed datą zamówienia — bez zmian statusu i wartości (jak dotąd). Oferty bez zmian.
--  3) crm.zamowienie_sklepowe_wygrany (mail „Nowe zamówienie” ze sklepu): „Zamówił” BEZ akceptowania ofert (zamiast
--     crm.oznacz_wynik); wartość = suma potwierdzonych zamówień z Baselinkera, a gdy klient ich jeszcze nie ma
--     (synchronizacja co 15 min) — kwota „razem” z maila, też nadpisująca; potem i tak poprawi ją Baselinker.
--     Zadania: handlowe zamykają się, pomiar / montaż / reklamacja / „dopytaj” zostają (jak w pkt 2); przy nietypowej
--     adnotacji „dopytaj” dostaje termin na dziś (jak dotąd).
--  4) trigger na crm.zamowienia_sklep reaguje też na zmianę kwoty potwierdzonego zamówienia (edycja w Baselinkerze) —
--     tylko przeliczenie wartości klienta „wygrany”, bez zmiany statusu.
--  5) jednorazowo: przeliczenie wartości wszystkich klientów „wygrany” z potwierdzonym zamówieniem sklepowym
--     (28.11: 23 klientów, zmieni się 6 — 3 bez wartości, 3 z kwotą z maila / szacunkiem).
-- Edge crm-bl-sync / crm-mail-* bez zmian. Zależy od 20261128033000 (wgrany). Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane).

create or replace function crm.wartosc_klienta_ze_sklepu(p_lead_id uuid, p_zrodlo text default 'baselinker', p_bl_id bigint default null)
 returns numeric
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  suma numeric;
  n int;
  stara numeric;
begin
  -- D17 (28.11): wartość klienta = suma potwierdzonych zamówień sklepowych (nadpisuje)
  select sum(z.kwota), count(*) into suma, n
  from crm.zamowienia_sklep z
  where z.lead_id = p_lead_id and z.potwierdzone and coalesce(z.kwota, 0) > 0 and coalesce(z.waluta, 'PLN') = 'PLN';
  if suma is null then return null; end if;
  select wartosc_szac into stara from crm.leady where id = p_lead_id for update;
  if not found then return null; end if;
  if stara is distinct from suma then
    update crm.leady set wartosc_szac = suma where id = p_lead_id;
    insert into crm.zdarzenia (lead_id, typ, opis, kto, dane)
    values (p_lead_id, 'wartosc_zmieniona',
      'Wartość klienta = kwota zamówień ze sklepu: ' || to_char(suma, 'FM999999990.00') || ' zł'
        || case when n > 1 then ' (' || n || ' zamówienia)' else '' end
        || coalesce(' (było ' || to_char(stara, 'FM999999990.00') || ' zł)', '') || ' — automatycznie',
      auth.uid(),
      jsonb_build_object('zrodlo', p_zrodlo, 'z', stara, 'na', suma, 'bl_id', p_bl_id, 'zamowien', n));
  end if;
  return suma;
end;
$function$;

revoke all on function crm.wartosc_klienta_ze_sklepu(uuid, text, bigint) from public, anon, authenticated;

create or replace function crm.zamowienie_bl_wygrany(p_bl_id bigint)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  z crm.zamowienia_sklep;
  l crm.leady;
  notatka text;
  zostaw boolean;
begin
  select * into z from crm.zamowienia_sklep where bl_id = p_bl_id;
  if not found then return 'nie ma zamówienia'; end if;
  if z.lead_id is null then return 'bez klienta'; end if;
  if not z.potwierdzone then return 'niepotwierdzone'; end if;
  select * into l from crm.leady where id = z.lead_id for update;
  if not found then return 'brak klienta w CRM'; end if;
  if l.status = 'wygrany' then
    -- D17 (28.11): wartość = kwota zamówień, także gdy klient już był „wygrany”
    perform crm.wartosc_klienta_ze_sklepu(l.id, 'baselinker', z.bl_id);
    return 'już wygrany';
  end if;
  if l.status = 'przegrany' and (z.data_zlozenia is null or l.wynik_at is null or z.data_zlozenia <= l.wynik_at) then
    return 'przegrany przed zamówieniem — bez zmian';
  end if;
  notatka := 'Zamówienie sklepowe BL ' || z.bl_id || coalesce(' (sklep ' || z.shop_order_id || ')', '')
    || coalesce(', ' || to_char(z.kwota, 'FM999999990.00') || ' ' || coalesce(z.waluta, 'PLN'), '') || ' (automatycznie z Baselinkera)';
  zostaw := l.nastepna_akcja in ('pomiar', 'montaz', 'reklamacja', 'dopytaj');
  update crm.leady set status = 'wygrany', wynik_powod = null, wynik_notatka = notatka, wynik_at = now(), wynik_kto = auth.uid()
  where id = l.id;
  if l.nastepna_akcja is not null and not zostaw then
    update crm.leady set nastepna_akcja = null, nastepny_krok = null, akcja_opis = null, akcja_od = null where id = l.id;
  end if;
  insert into crm.zdarzenia (lead_id, typ, opis, kto, dane)
  values (l.id, 'wygrany', 'Klient zamówił: ' || notatka || '.', auth.uid(),
    jsonb_build_object('zrodlo', 'baselinker', 'bl_id', z.bl_id, 'kwota', z.kwota, 'poprzedni_status', l.status,
      'notatka', notatka, 'zadanie_zostaje', case when zostaw then l.nastepna_akcja end));
  -- D17 (28.11): wartość klienta = kwota zamówień (nadpisuje); oferty bez zmian
  perform crm.wartosc_klienta_ze_sklepu(l.id, 'baselinker', z.bl_id);
  return 'wygrany';
end;
$function$;

revoke all on function crm.zamowienie_bl_wygrany(bigint) from public, anon, authenticated;

create or replace function crm.zamowienie_sklepowe_wygrany(p_mail_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m crm.maile;
  zam jsonb;
  lid uuid;
  l crm.leady;
  tel text;
  nietypowe boolean;
  kwota numeric;
  notatka text;
  zostaw boolean;
  bylo_wygrany boolean;
begin
  select * into m from crm.maile where id = p_mail_id;
  if not found then return 'nie ma maila'; end if;
  if m.typ is distinct from 'zamowienie' then return 'to nie zamówienie'; end if;
  zam := m.analiza->'zamowienie';
  if coalesce(zam->>'rodzaj', '') <> 'nowe' then return 'nie „nowe” (' || coalesce(zam->>'rodzaj', '?') || ')'; end if;
  tel := crm.telefon_e164(zam->>'telefon');
  lid := m.lead_id;
  if lid is null then
    select id into lid from crm.znajdz_leada(lower(m.od_adres), tel) limit 1;
  end if;
  if lid is null then return 'brak klienta w CRM'; end if;
  select * into l from crm.leady where id = lid for update;
  if not found then return 'brak klienta w CRM'; end if;
  if m.lead_id is null then update crm.maile set lead_id = lid where id = m.id; end if;
  bylo_wygrany := l.status = 'wygrany';
  nietypowe := coalesce((m.analiza->'ocena'->>'nietypowe')::boolean, false);
  if not bylo_wygrany then
    -- D17 (28.11): „Zamówił” bez akceptowania ofert (oferty przy zamówieniu ze sklepu nie mają znaczenia)
    notatka := 'Zamówienie sklepowe nr ' || coalesce(zam->>'numer', '?') || coalesce(', ' || (zam->>'razem'), '') || ' (automatycznie z maila sklepu)';
    zostaw := l.nastepna_akcja in ('pomiar', 'montaz', 'reklamacja', 'dopytaj');
    update crm.leady set status = 'wygrany', wynik_powod = null, wynik_notatka = notatka, wynik_at = now(), wynik_kto = auth.uid()
    where id = lid;
    if l.nastepna_akcja is not null and not zostaw then
      update crm.leady set nastepna_akcja = null, nastepny_krok = null, akcja_opis = null, akcja_od = null where id = lid;
    end if;
    -- nietypowa adnotacja: zadanie „dopytaj” zostaje z terminem na dziś — trzeba wyjaśnić z klientem przed realizacją
    if nietypowe and l.nastepna_akcja = 'dopytaj' then
      update crm.leady set nastepny_krok = crm.termin_roboczy(current_date), akcja_od = now() where id = lid;
    end if;
    insert into crm.zdarzenia (lead_id, typ, opis, kto, dane)
    values (lid, 'wygrany', 'Klient zamówił: ' || notatka || '.', auth.uid(),
      jsonb_build_object('zrodlo', 'mail_sklepu', 'mail_id', m.id, 'oferta_id', null, 'notatka', notatka,
        'poprzedni_status', l.status, 'zadanie_zostaje', case when zostaw then l.nastepna_akcja end));
  end if;
  -- D17 (28.11): wartość klienta = suma potwierdzonych zamówień z Baselinkera; gdy jeszcze ich nie ma — kwota z maila
  if crm.wartosc_klienta_ze_sklepu(lid, 'mail_sklepu', null) is null then
    kwota := crm.kwota_z_tekstu(zam->>'razem');
    if kwota is not null and kwota > 0 and l.wartosc_szac is distinct from kwota then
      update crm.leady set wartosc_szac = kwota where id = lid;
      insert into crm.zdarzenia (lead_id, typ, opis, kto, dane)
      values (lid, 'wartosc_zmieniona',
        'Wartość klienta = kwota zamówienia ze sklepu (z maila): ' || to_char(kwota, 'FM999999990.00') || ' zł'
          || coalesce(' (było ' || to_char(l.wartosc_szac, 'FM999999990.00') || ' zł)', '') || ' — automatycznie',
        auth.uid(), jsonb_build_object('zrodlo', 'mail_sklepu', 'mail_id', m.id, 'z', l.wartosc_szac, 'na', kwota));
    end if;
  end if;
  return case when bylo_wygrany then 'już wygrany' else 'wygrany' end;
end;
$function$;

revoke all on function crm.zamowienie_sklepowe_wygrany(uuid) from public, anon, authenticated;

create or replace function crm.zamowienia_sklep_wygrany_tg()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.lead_id is not null and new.potwierdzone
     and (tg_op = 'INSERT' or old.lead_id is distinct from new.lead_id or not old.potwierdzone) then
    begin
      perform crm.zamowienie_bl_wygrany(new.bl_id);
    exception when others then
      raise warning 'crm.zamowienie_bl_wygrany(%): %', new.bl_id, sqlerrm;
    end;
  elsif tg_op = 'UPDATE' and new.lead_id is not null and new.potwierdzone and old.kwota is distinct from new.kwota then
    -- D17 (28.11): zmiana kwoty potwierdzonego zamówienia → przeliczenie wartości klienta „wygrany”
    begin
      if exists (select 1 from crm.leady where id = new.lead_id and status = 'wygrany') then
        perform crm.wartosc_klienta_ze_sklepu(new.lead_id, 'baselinker', new.bl_id);
      end if;
    exception when others then
      raise warning 'crm.wartosc_klienta_ze_sklepu(%): %', new.bl_id, sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

revoke all on function crm.zamowienia_sklep_wygrany_tg() from public, anon, authenticated;

drop trigger if exists zamowienia_sklep_wygrany on crm.zamowienia_sklep;
create trigger zamowienia_sklep_wygrany
  after insert or update of lead_id, potwierdzone, kwota on crm.zamowienia_sklep
  for each row
  execute function crm.zamowienia_sklep_wygrany_tg();

-- 5) jednorazowo: wartość klientów „wygrany” z potwierdzonymi zamówieniami sklepowymi
do $$
declare r record; n int := 0; stara numeric; nowa numeric;
begin
  for r in
    select distinct l.id, l.wartosc_szac
    from crm.leady l join crm.zamowienia_sklep zs on zs.lead_id = l.id and zs.potwierdzone
    where l.status = 'wygrany'
  loop
    nowa := crm.wartosc_klienta_ze_sklepu(r.id, 'baselinker', null);
    if nowa is not null and nowa is distinct from r.wartosc_szac then n := n + 1; end if;
  end loop;
  raise notice 'D17: klientów „wygrany” ze zmienioną wartością (= kwota zamówień sklepowych): %', n;
end $$;
