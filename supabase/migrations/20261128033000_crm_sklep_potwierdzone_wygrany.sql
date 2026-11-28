-- 28.11.2026 (decyzja właściciela D17 — TAK wg rekomendacji): klient ze sklepu z potwierdzonym zamówieniem → „Zamówił”.
-- Problem: Edge crm-bl-sync przypina nowe zamówienie z Baselinkera do istniejącego klienta CRM (crm.zamowienia_sklep.lead_id),
-- ale nie zmienia jego statusu — 28.11 było 10 klientów „nowy/oferta” z potwierdzonym (9 z nich opłaconym) zamówieniem.
-- Istniejąca zasada „zamówienie sklepowe = Zamówił” działała tylko dla maila „Nowe zamówienie” ze sklepu
-- (crm.zamowienie_sklepowe_wygrany, trigger na crm.maile) i dla klienta zakładanego z karty zamówienia
-- (crm.klient_zamowienia_sklep) — mail nie zawsze trafia do klienta (inny adres, Reply-To), a Baselinker zawsze.
-- Teraz: trigger AFTER INSERT / UPDATE OF lead_id, potwierdzone na crm.zamowienia_sklep — gdy zamówienie właśnie zostało
-- przypięte do klienta albo właśnie potwierdzone (tylko przejście, więc cykliczny upsert crm-bl-sync co 15 min niczego
-- nie powtarza, a ręczne „Cofnij »Zamówił«” nie zostanie nadpisane) → crm.zamowienie_bl_wygrany(bl_id):
--   * klient „nowy” / „oferta” → „wygrany”; „przegrany” tylko gdy zamówienie złożono PO dacie przegranej (stare
--     zamówienie dopięte później nie odwraca decyzji handlowca); „wygrany” → bez zmian;
--   * wynik_notatka / zdarzenie „wygrany”: „Zamówienie sklepowe BL … (automatycznie z Baselinkera)”, dane.zrodlo = 'baselinker';
--   * wartość klienta = kwota zamówienia, gdy nikt jej nie wpisał (jak w zasadzie z maila);
--   * zadanie: handlowe (follow_up, przygotuj_oferte, oddzwon) zamyka się jak przy ręcznym „Zamówił”; umówiony pomiar,
--     montaż, reklamacja i „dopytaj” (np. nietypowa adnotacja do zamówienia) ZOSTAJĄ (wersja najbezpieczniejsza);
--   * oferty NIE są zmieniane (inaczej niż ręczne „Zamówił”, które akceptuje najnowszą wysłaną): kwota zamówienia sklepowego
--     zwykle nie odpowiada żadnej ofercie (28.11: klient z dwiema wysłanymi 14 000 / 20 000 zamówił za 18 900) —
--     pytanie do właściciela w raporcie.
-- Błąd w automacie nie blokuje zapisu zamówienia (warning) — zamówienie ma się przypiąć zawsze.
-- Na końcu jednorazowo: ta sama reguła dla klientów, którzy JUŻ mają potwierdzone zamówienie (28.11: 10 klientów).
-- Działa też przy łączeniu klientów (crm.polacz_leady przenosi zamówienia na klienta docelowego → „Zamówił”).
-- Edge crm-bl-sync bez zmian (nie trzeba wdrażać). DO WDROŻENIA (nie wgrane).

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
  -- wartość klienta = kwota zamówienia, gdy nikt nie wpisał jej ręcznie (jak crm.zamowienie_sklepowe_wygrany)
  if l.wartosc_szac is null and coalesce(z.kwota, 0) > 0 then
    update crm.leady set wartosc_szac = z.kwota where id = l.id;
  end if;
  if l.status = 'wygrany' then return 'już wygrany'; end if;
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
  return 'wygrany';
end;
$function$;

revoke all on function crm.zamowienie_bl_wygrany(bigint) from public, anon, authenticated;

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
  end if;
  return new;
end;
$function$;

revoke all on function crm.zamowienia_sklep_wygrany_tg() from public, anon, authenticated;

drop trigger if exists zamowienia_sklep_wygrany on crm.zamowienia_sklep;
create trigger zamowienia_sklep_wygrany
  after insert or update of lead_id, potwierdzone on crm.zamowienia_sklep
  for each row
  execute function crm.zamowienia_sklep_wygrany_tg();

-- jednorazowo: klienci „nowy” / „oferta” (i przegrani po dacie przegranej), którzy już mają potwierdzone zamówienie
do $$
declare r record; n int := 0;
begin
  for r in
    select distinct on (zs.lead_id) zs.bl_id
    from crm.zamowienia_sklep zs join crm.leady l on l.id = zs.lead_id
    where zs.potwierdzone and l.status in ('nowy', 'oferta', 'przegrany')
    order by zs.lead_id, zs.data_zlozenia desc nulls last, zs.bl_id desc
  loop
    if crm.zamowienie_bl_wygrany(r.bl_id) = 'wygrany' then n := n + 1; end if;
  end loop;
  raise notice 'D17: klientów oznaczonych jako „Zamówił” z potwierdzonego zamówienia sklepowego: %', n;
end $$;
