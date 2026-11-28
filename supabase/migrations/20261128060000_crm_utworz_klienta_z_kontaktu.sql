-- 28.11.2026 — zgłoszenie właściciela (CRM Po Drzwi): „takie zapytanie nie powinno się w ogóle zapisywać jako Klienci —
-- musimy umieć odróżnić coś, w czym jest potencjał sprzedażowy, od śmieci”.
-- Edge crm-call-ingest (potencjal.ts) od teraz NIE zakłada klienta dla nowego numeru / adresu, gdy AI oceni potencjał
-- sprzedażowy na „nie” — rozmowa / mail zostaje bez klienta (lead_id null) z dopiskiem „Bez potencjału: …” w podsumowaniu.
-- Aplikacja pokazuje takie kontakty w Klienci → „Bez klienta” z przyciskiem „Utwórz klienta” (gdy AI się pomyliło).
-- Ta migracja: crm.utworz_klienta_z_kontaktu(p_rozmowa_id | p_mail_id) — dla rozmowy / maila przychodzącego bez klienta:
--   * szuka istniejącego klienta (crm.znajdz_leada: ten sam numer / adres albo z połączonych kontaktów; NIE po samej domenie),
--   * gdy nie ma — zakłada nowego: status 'nowy', źródło telefon / mail / formularz, nazwa, miejscowość, kategoria i
--     podsumowanie z analizy AI (bez zadania — handlowiec ustawia je na karcie klienta; bez wołania funkcji Edge),
--   * przypina rozmowę / mail (lead_id) i zdarzenia tej rozmowy / maila zapisane bez klienta (dane.rozmowa_id / mail_id),
--   * zdarzenie 'lead_utworzony' (kto = zalogowany) albo 'dopasowano' (przypięto do istniejącego).
-- Mail: wstawienie klienta z adresem e-mail uruchamia istniejący trigger crm.leady_dopnij_maile (przypina też inne maile
-- z tego adresu, które czekały bez klienta) — jak przy ręcznym dodaniu klienta.
-- Dostęp: tylko zalogowany z dostępem do CRM (public.current_user_has_crm()); EXECUTE dla authenticated i service_role.
-- Niezależna od innych plików; można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane). Wgrać razem z wdrożeniem Edge crm-call-ingest (inaczej „Utwórz klienta” w aplikacji
-- pokaże „funkcja czeka na aktualizację bazy”).

create or replace function crm.utworz_klienta_z_kontaktu(p_rozmowa_id uuid default null, p_mail_id uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  r crm.rozmowy;
  m crm.maile;
  a jsonb := '{}'::jsonb;
  v_tel text;
  v_email text;
  v_tel_z_analizy text;
  v_lead uuid;
  v_nowy boolean := false;
  v_zrodlo text;
  v_kat text;
  v_kiedy timestamptz;
  v_skad text;
begin
  if uid is null or not public.current_user_has_crm() then
    raise exception 'Brak dostępu do CRM' using errcode = '42501';
  end if;
  if (p_rozmowa_id is null) = (p_mail_id is null) then
    raise exception 'Wskaż jedną rozmowę albo jeden mail' using errcode = 'P0412';
  end if;

  if p_rozmowa_id is not null then
    select * into r from crm.rozmowy where id = p_rozmowa_id for update;
    if not found then
      raise exception 'Nie ma takiej rozmowy' using errcode = 'P0412';
    end if;
    if r.lead_id is not null then
      return jsonb_build_object('lead_id', r.lead_id, 'nowy', false, 'juz_przypieta', true);
    end if;
    v_tel := nullif(btrim(case when r.kierunek = 'wychodzaca' then r.numer_docelowy else r.numer_dzwoniacego end), '');
    if v_tel is null then
      raise exception 'Rozmowa bez numeru (zastrzeżony) — dodaj klienta ręcznie przyciskiem „Dodaj klienta”' using errcode = 'P0412';
    end if;
    if jsonb_typeof(r.analiza) = 'object' then a := r.analiza; end if;
    v_zrodlo := 'telefon';
    v_kiedy := coalesce(r.data_rozmowy, r.created_at);
    v_skad := 'z rozmowy ' || to_char(v_kiedy at time zone 'Europe/Warsaw', 'DD.MM HH24:MI');
    select z.id into v_lead from crm.znajdz_leada(null, v_tel) z where z.powod in ('telefon', 'inne_kontakty');
    -- e-mail podany w rozmowie (jak w Edge: tylko do nowego klienta)
    v_email := lower(nullif(btrim(a->>'email'), ''));
    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; end if;
  else
    select * into m from crm.maile where id = p_mail_id for update;
    if not found then
      raise exception 'Nie ma takiego maila' using errcode = 'P0412';
    end if;
    if m.lead_id is not null then
      return jsonb_build_object('lead_id', m.lead_id, 'nowy', false, 'juz_przypieta', true);
    end if;
    if m.kierunek is distinct from 'przychodzacy' then
      raise exception 'Klienta można utworzyć tylko z maila przychodzącego' using errcode = 'P0412';
    end if;
    v_email := lower(nullif(btrim(m.od_adres), ''));
    if v_email is null then
      raise exception 'Mail bez adresu nadawcy' using errcode = 'P0412';
    end if;
    if jsonb_typeof(m.analiza) = 'object' then a := m.analiza; end if;
    v_zrodlo := case when m.kanal = 'formularz' then 'formularz' else 'mail' end;
    v_kiedy := coalesce(m.data, m.created_at);
    v_skad := 'z maila „' || left(coalesce(nullif(btrim(m.temat), ''), 'bez tematu'), 80) || '”';
    select z.id into v_lead from crm.znajdz_leada(v_email, null) z where z.powod in ('email', 'inne_kontakty');
    -- numer z podpisu: tylko gdy żaden klient go nie ma (telefon jest unikalny)
    v_tel_z_analizy := crm.telefon_e164(nullif(btrim(a->>'telefon'), ''));
    if v_tel_z_analizy is not null and not exists (select 1 from crm.leady l where l.telefon = v_tel_z_analizy) then
      v_tel := v_tel_z_analizy;
    end if;
  end if;

  if v_lead is null then
    v_kat := nullif(btrim(a->>'kategoria'), '');
    if v_kat = 'nieznana' then v_kat := null; end if;
    insert into crm.leady (telefon, email, nazwa, miejscowosc, kategoria, zrodlo, status, podsumowanie, ostatnia_rozmowa_at)
    values (
      v_tel,
      v_email,
      left(coalesce(nullif(btrim(a->>'nazwa'), ''), nullif(btrim(m.od_nazwa), '')), 200),
      left(nullif(btrim(a->>'miejscowosc'), ''), 120),
      v_kat,
      v_zrodlo,
      'nowy',
      left(coalesce(nullif(btrim(a->>'podsumowanie'), ''), r.podsumowanie, m.podsumowanie), 2000),
      v_kiedy
    )
    on conflict (telefon) do nothing
    returning id into v_lead;
    if v_lead is null then
      -- wyścig: ktoś w tej chwili założył klienta z tym numerem
      select l.id into v_lead from crm.leady l where l.telefon = v_tel;
    else
      v_nowy := true;
    end if;
  end if;

  if p_rozmowa_id is not null then
    update crm.rozmowy set lead_id = v_lead where id = p_rozmowa_id;
    update crm.zdarzenia set lead_id = v_lead where lead_id is null and dane->>'rozmowa_id' = p_rozmowa_id::text;
  else
    update crm.maile set lead_id = v_lead where id = p_mail_id;
    update crm.zdarzenia set lead_id = v_lead where lead_id is null and dane->>'mail_id' = p_mail_id::text;
  end if;
  update crm.leady set ostatnia_rozmowa_at = v_kiedy
   where id = v_lead and (ostatnia_rozmowa_at is null or ostatnia_rozmowa_at < v_kiedy);

  insert into crm.zdarzenia (lead_id, typ, opis, kto, dane)
  values (
    v_lead,
    case when v_nowy then 'lead_utworzony' else 'dopasowano' end,
    case when v_nowy then 'Klient utworzony ręcznie ' || v_skad || ' (system uznał kontakt za bez potencjału)'
         else 'Przypięto ręcznie ' || v_skad || ' (kontakt był bez klienta)' end,
    uid,
    jsonb_build_object('rozmowa_id', p_rozmowa_id, 'mail_id', p_mail_id, 'recznie', true, 'zrodlo', 'bez_klienta')
  );

  return jsonb_build_object('lead_id', v_lead, 'nowy', v_nowy, 'juz_przypieta', false);
end;
$function$;

revoke all on function crm.utworz_klienta_z_kontaktu(uuid, uuid) from public, anon;
grant execute on function crm.utworz_klienta_z_kontaktu(uuid, uuid) to authenticated, service_role;

comment on function crm.utworz_klienta_z_kontaktu(uuid, uuid) is
  '28.11: „Utwórz klienta” z listy „Bez klienta” — zakłada (albo znajduje) klienta z numeru rozmowy / adresu maila i przypina kontakt.';
