-- 28.11.2026 — decyzja D19, odpowiedź właściciela: po odstąpieniu od podpisanej umowy klient przechodzi na „przegrany”
-- z powodem „rezygnacja”.
-- Było (20261128033200 — WGRANY): crm.odstap_od_umowy anulowała umowę i zapisywała zdarzenie 'umowa_odstapienie',
-- ale status klienta zostawał bez zmian (zwykle „wygrany”).
-- Teraz: ta sama funkcja (create or replace, ta sama sygnatura i uprawnienia), po anulowaniu umowy woła istniejące
-- crm.oznacz_wynik(klient, 'przegrany', 'rezygnacja', 'Odstąpienie od umowy nr …: powód') — te same pola
-- (status, wynik_powod, wynik_notatka, wynik_at, wynik_kto, zadanie zdjęte) i to samo zdarzenie 'przegrany'
-- („Klient przegrany: zrezygnował – …”) co ręczne „Przegrany” w aplikacji; wysłane (niezaakceptowane) oferty klienta
-- dostają „odrzucona” jak przy każdej przegranej. Klient już „przegrany” — bez zmian. Powtórne wywołanie dla
-- anulowanej umowy (juz = true) nie zmienia klienta. Wynik rpc ma nowy klucz klient_status ('przegrany' / null).
-- Aplikacja: komunikat po odstąpieniu mówi, że klient jest „Przegrany (rezygnacja)”, gdy rpc to zwróci (przed
-- migracją — dotychczasowy komunikat); ekran klienta i tak przeładowuje się po odstąpieniu.
-- Zależy od 20261128033200 (wgrany). Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane).

create or replace function crm.odstap_od_umowy(p_dokument_id uuid, p_powod text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  d crm.dokumenty;
  powod text := nullif(btrim(coalesce(p_powod, '')), '');
  st text;
  klient text := null;
begin
  if uid is null or not public.current_user_has_crm() then
    raise exception 'Brak dostępu do CRM' using errcode = '42501';
  end if;
  if powod is null or char_length(powod) < 3 then
    raise exception 'Wpisz powód odstąpienia od umowy (np. „klient odstąpił w terminie 14 dni”).' using errcode = 'P0412';
  end if;
  select * into d from crm.dokumenty where id = p_dokument_id for update;
  if not found then
    raise exception 'Nie ma takiej umowy' using errcode = 'P0412';
  end if;
  if d.rodzaj <> 'umowa' then
    raise exception 'Odstąpienie dotyczy tylko umowy' using errcode = 'P0412';
  end if;
  if d.status = 'anulowana' then
    return jsonb_build_object('ok', true, 'status', 'anulowana', 'juz', true, 'klient_status', null);
  end if;
  if d.status <> 'podpisana' then
    raise exception 'Umowa nr % nie jest podpisana (status: %) — zmień status zwykłą listą.', coalesce(d.numer, '?'), d.status using errcode = 'P0412';
  end if;
  perform set_config('crm.odstapienie_umowy', d.id::text, true);
  update crm.dokumenty
     set status = 'anulowana',
         dane = coalesce(dane, '{}'::jsonb) || jsonb_build_object('odstapienie', jsonb_build_object('powod', left(powod, 500), 'kto', uid, 'kiedy', now()))
   where id = d.id;
  perform set_config('crm.odstapienie_umowy', '', true);
  insert into crm.zdarzenia (lead_id, oferta_id, typ, opis, kto, dane)
  values (d.lead_id, d.oferta_id, 'umowa_odstapienie',
    'Odstąpienie od umowy nr ' || coalesce(d.numer, '?') || ': ' || left(powod, 500) || '.', uid,
    jsonb_build_object('dokument_id', d.id, 'numer', d.numer, 'powod', left(powod, 500), 'zrodlo', 'klik'));
  -- D19 (28.11, właściciel): klient → „przegrany” z powodem „rezygnacja” (ta sama ścieżka co ręczne „Przegrany”)
  select status into st from crm.leady where id = d.lead_id;
  if found and st is distinct from 'przegrany' then
    perform crm.oznacz_wynik(d.lead_id, 'przegrany', 'rezygnacja',
      'Odstąpienie od umowy nr ' || coalesce(d.numer, '?') || ': ' || left(powod, 400), null);
    klient := 'przegrany';
  end if;
  return jsonb_build_object('ok', true, 'status', 'anulowana', 'juz', false, 'klient_status', klient);
end;
$function$;

revoke all on function crm.odstap_od_umowy(uuid, text) from public, anon;
grant execute on function crm.odstap_od_umowy(uuid, text) to authenticated;
