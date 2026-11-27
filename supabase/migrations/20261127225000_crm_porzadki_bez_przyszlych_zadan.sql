-- 27.11.2026 (sesja testów, runda 2; tester CRM backend, WYSOKI): crm.codzienne_porzadki oznaczał klienta jako
-- „przegrany – brak kontaktu” po 30 dniach bez aktywności, nawet gdy handlowiec ustawił mu zadanie na przyszłość
-- (np. „odezwą się po Nowym Roku”, termin 11.01.2027) — i kasował to zadanie. Teraz klient z zadaniem na dziś lub
-- później jest pomijany. Poprawka (testy 27.11, runda 3; NISKI): zadanie bez daty (nastepny_krok is null) liczy się
-- jak brak zadania w przyszłości (coalesce) — wcześniej NULL w warunku blokował zamknięcie na zawsze (27.11: 0 takich).
-- Podmiana jednego warunku w istniejącej funkcji. DO WDROŻENIA (nie wgrane w sesji).
do $$
declare d text;
  stare text := '    where l.status in (''nowy'', ''oferta'')
  loop';
  nowe text := '    where l.status in (''nowy'', ''oferta'')
      and not (l.nastepna_akcja is not null and coalesce(l.nastepny_krok >= dzis, false))
  loop';
begin
  d := pg_get_functiondef('crm.codzienne_porzadki()'::regprocedure);
  if position(stare in d) = 0 then
    raise notice 'crm.codzienne_porzadki: warunek już poprawiony albo inny — bez zmian';
    return;
  end if;
  execute replace(d, stare, nowe);
end $$;
