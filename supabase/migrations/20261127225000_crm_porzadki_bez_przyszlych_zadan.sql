-- 27.11.2026 (sesja testów, runda 2; tester CRM backend, WYSOKI): crm.codzienne_porzadki oznaczał klienta jako
-- „przegrany – brak kontaktu” po 30 dniach bez aktywności, nawet gdy handlowiec ustawił mu zadanie na przyszłość
-- (np. „odezwą się po Nowym Roku”, termin 11.01.2027) — i kasował to zadanie. Teraz klient z zadaniem na dziś lub
-- później jest pomijany. Poprawka (testy 27.11, runda 3; NISKI): zadanie bez daty (nastepny_krok is null) liczy się
-- jak brak zadania w przyszłości (coalesce) — wcześniej NULL w warunku blokował zamknięcie na zawsze (27.11: 0 takich).
-- Poprawka (testy 27.11, runda 3; KRYTYCZNY, część bezpieczna): klient, który ma zamówienie sklepowe potwierdzone albo
-- (choć częściowo) opłacone (crm.zamowienia_sklep z jego lead_id: potwierdzone = true albo oplacone > 0), nie jest
-- zamykany jako przegrany — 27.11 takich klientów w statusie nowy/oferta było 10 (np. zapłacone 6360 zł, a automat
-- po 30 dniach dałby „przegrany”). Status sklepowy (np. anulowane w sklepie) nie jest sprawdzany — w razie wątpliwości
-- automat po prostu nie zamyka (handlowiec zamknie ręcznie).
-- Przy okazji (NISKI): gdy porządki zamykają klienta jako przegranego, jego oferty 'wyslana' → 'odrzucona' — tak samo
-- jak ręczne „przegrany” w crm.oznacz_wynik (bez wskazanej oferty); liczba trafia do zdarzenia (ofert_odrzuconych).
-- Podmiana fragmentów istniejącej funkcji. DO WDROŻENIA (nie wgrane w sesji).
do $$
declare d text;
  stare text := '    where l.status in (''nowy'', ''oferta'')
  loop';
  nowe text := '    where l.status in (''nowy'', ''oferta'')
      and not (l.nastepna_akcja is not null and coalesce(l.nastepny_krok >= dzis, false))
      -- klient z potwierdzonym / opłaconym zamówieniem w sklepie nie jest „przegrany” (testy 27.11, runda 3)
      and not exists (select 1 from crm.zamowienia_sklep zs
                      where zs.lead_id = l.id and (zs.potwierdzone or coalesce(zs.oplacone, 0) > 0))
  loop';
  stare2 text := '  r record;
begin';
  nowe2 text := '  r record;
  n_odrz int;
begin';
  stare3 text := '      where id = r.id;
      insert into crm.zdarzenia (lead_id, typ, opis, dane)';
  nowe3 text := '      where id = r.id;
      -- oferty wysłane → odrzucone, jak przy ręcznym „przegrany” (crm.oznacz_wynik)
      update crm.oferty set status = ''odrzucona'' where lead_id = r.id and status = ''wyslana'';
      get diagnostics n_odrz = row_count;
      insert into crm.zdarzenia (lead_id, typ, opis, dane)';
  stare4 text := 'jsonb_build_object(''zrodlo'', ''cron'', ''ostatnia_aktywnosc'', r.ostatnia, ''powod'', ''brak_kontaktu'')';
  nowe4 text := 'jsonb_build_object(''zrodlo'', ''cron'', ''ostatnia_aktywnosc'', r.ostatnia, ''powod'', ''brak_kontaktu'', ''ofert_odrzuconych'', n_odrz)';
begin
  d := pg_get_functiondef('crm.codzienne_porzadki()'::regprocedure);
  if position(stare in d) = 0 then
    raise notice 'crm.codzienne_porzadki: warunek już poprawiony albo inny — bez zmian';
    return;
  end if;
  if position(stare2 in d) = 0 or position(stare3 in d) = 0 or position(stare4 in d) = 0 then
    raise exception 'crm.codzienne_porzadki: nie znaleziono wszystkich miejsc łatki — sprawdź definicję';
  end if;
  execute replace(replace(replace(replace(d, stare, nowe), stare2, nowe2), stare3, nowe3), stare4, nowe4);
end $$;
