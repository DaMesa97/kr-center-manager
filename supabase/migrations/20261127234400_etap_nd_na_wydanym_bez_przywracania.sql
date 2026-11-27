-- 27.11.2026 (testy 27.11, runda 3; WYSOKI): update_order_stage na WYDANYM zleceniu (release_date ustawione)
-- przy zmianie #ND na puste / „KR” / #W wołało restore_stage_reservations__impl — rezerwacja wracała do 'reserved'
-- i zostawała tak na zawsze (zlecenie wydane, nic jej już nie zdejmie). Po 20261127233000 (#ND anuluje także
-- rezerwacje zdjęte wydaniem końcowym) dotyczy to każdego wydanego zlecenia.
-- Teraz w tej gałęzi na wydanym zleceniu odmowa P0409 w formacie jak w 20261127230000 (revert_order_stage),
-- więc aplikacja (src/lib/friendlyError.ts) przetłumaczy komunikat. Wyjątek przerywa całe wywołanie — wpis etapu
-- też się cofa. Wpisanie #ND na wydanym (anulowanie / zwrot) działa jak dotąd.
-- Działa z 20261127233000 i bez niego (233000 nie zmienia update_order_stage).
-- DO WDROŻENIA (nie wgrane w sesji).
do $$
declare
  d text;
  stare text := '    elsif upper(v_cur) = ''#ND'' and upper(v_new) <> ''#ND'' then
      v_restored := public.restore_stage_reservations__impl(p_order_id, p_stage_key);';
  nowe text := '    elsif upper(v_cur) = ''#ND'' and upper(v_new) <> ''#ND'' then
      -- wydane zlecenie: rezerwacja wróciłaby na zawsze (testy 27.11 (runda 3), wydane)
      if exists (select 1 from orders o where o.id = p_order_id and o.release_date is not null) then
        raise exception ''Zlecenie jest już wydane (%) — najpierw cofnij wydanie, potem zmień etap.'',
          (select o.release_date::text from orders o where o.id = p_order_id)
          using errcode = ''P0409'';
      end if;
      v_restored := public.restore_stage_reservations__impl(p_order_id, p_stage_key);';
begin
  d := pg_get_functiondef('public.update_order_stage(bigint,text,text)'::regprocedure);
  if position('testy 27.11 (runda 3), wydane' in d) > 0 then
    raise notice 'update_order_stage: już poprawione — bez zmian';
    return;
  end if;
  if position(stare in d) = 0 then
    raise exception 'update_order_stage: nie znaleziono miejsca łatki — sprawdź definicję';
  end if;
  execute replace(d, stare, nowe);
end $$;
