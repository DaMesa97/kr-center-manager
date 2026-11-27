-- 27.11.2026 (sesja testów, runda 2; tester CRM backend, KRYTYCZNY): crm.polacz_leady
--  1) etykiety obu klientów były sumowane — przy dwóch etykietach z grupy „jedna na grupę” (np. „inwestycja” i „firma”)
--     trigger sprawdz_etykiety odrzucał zapis i łączenie się nie udawało (2 z 5 par duplikatów). Teraz z takiej grupy
--     zostaje etykieta klienta docelowego, a etykieta źródła tylko wtedy, gdy cel nie ma żadnej z tej grupy;
--  2) zamówienia sklepowe (crm.zamowienia_sklep, FK ON DELETE SET NULL) klienta źródłowego traciły powiązanie na zawsze —
--     teraz przechodzą na klienta docelowego;
--  3) dane firmy (NIP, nazwa, adres, REGON, KRS, VAT, źródło), profil społecznościowy i szczegół źródła klienta
--     źródłowego kasowały się razem z nim — teraz uzupełniają klienta docelowego (komplet firmy z tego, kto ma NIP).
--     Poprawka (testy 27.11, runda 3; NISKI): gdy NIP pochodzi ze źródła, pole firmy, którego źródło nie ma, zostaje
--     z klienta docelowego (coalesce(źródło, cel)) — wcześniej np. nazwa/miasto celu bez NIP były kasowane na NULL.
-- Podmiana fragmentów istniejącej funkcji (reszta bez zmian). DO WDROŻENIA (nie wgrane w sesji).
do $$
declare d text;
begin
  d := pg_get_functiondef('crm.polacz_leady(uuid,uuid)'::regprocedure);
  if position('zamowienia_sklep' in d) > 0 then
    raise notice 'crm.polacz_leady: już poprawione — bez zmian';
    return;
  end if;
  d := replace(d,
    'update crm.zdarzenia set lead_id = p_cel where lead_id = p_zrodlo;',
    'update crm.zdarzenia set lead_id = p_cel where lead_id = p_zrodlo;
  update crm.zamowienia_sklep set lead_id = p_cel where lead_id = p_zrodlo;');
  d := replace(d,
    'etykiety = (select coalesce(array_agg(distinct e), ''{}'') from unnest(c.etykiety || z.etykiety) e),',
    'etykiety = c.etykiety || coalesce((select array_agg(distinct e) from unnest(z.etykiety) e join crm.etykiety x on x.slug = e
      where not x.jedna_na_grupe or not exists (select 1 from unnest(c.etykiety) ce join crm.etykiety y on y.slug = ce where y.grupa = x.grupa)), ''{}''),');
  d := replace(d,
    'asana_task_gid = coalesce(c.asana_task_gid, z.asana_task_gid),',
    'asana_task_gid = coalesce(c.asana_task_gid, z.asana_task_gid),
    nip = coalesce(c.nip, z.nip),
    firma_nazwa = case when c.nip is null and z.nip is not null then coalesce(z.firma_nazwa, c.firma_nazwa) else coalesce(c.firma_nazwa, z.firma_nazwa) end,
    firma_ulica = case when c.nip is null and z.nip is not null then coalesce(z.firma_ulica, c.firma_ulica) else coalesce(c.firma_ulica, z.firma_ulica) end,
    firma_kod = case when c.nip is null and z.nip is not null then coalesce(z.firma_kod, c.firma_kod) else coalesce(c.firma_kod, z.firma_kod) end,
    firma_miasto = case when c.nip is null and z.nip is not null then coalesce(z.firma_miasto, c.firma_miasto) else coalesce(c.firma_miasto, z.firma_miasto) end,
    regon = case when c.nip is null and z.nip is not null then coalesce(z.regon, c.regon) else coalesce(c.regon, z.regon) end,
    krs = case when c.nip is null and z.nip is not null then coalesce(z.krs, c.krs) else coalesce(c.krs, z.krs) end,
    vat_status = case when c.nip is null and z.nip is not null then coalesce(z.vat_status, c.vat_status) else coalesce(c.vat_status, z.vat_status) end,
    firma_zrodlo = case when c.nip is null and z.nip is not null then coalesce(z.firma_zrodlo, c.firma_zrodlo) else coalesce(c.firma_zrodlo, z.firma_zrodlo) end,
    firma_sprawdzono_at = case when c.nip is null and z.nip is not null then coalesce(z.firma_sprawdzono_at, c.firma_sprawdzono_at) else coalesce(c.firma_sprawdzono_at, z.firma_sprawdzono_at) end,
    profil_social = coalesce(c.profil_social, z.profil_social),
    zrodlo_szczegol = coalesce(c.zrodlo_szczegol, z.zrodlo_szczegol),');
  if position('zamowienia_sklep' in d) = 0 or position('jedna_na_grupe' in d) = 0 or position('firma_sprawdzono_at' in d) = 0 then
    raise exception 'crm.polacz_leady: nie udało się podmienić wszystkich fragmentów — przerwane';
  end if;
  execute d;
end $$;
