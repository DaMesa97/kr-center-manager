-- 27.11.2026 (testy 27.11, runda 3) — JEDNORAZOWE PORZĄDKI DANYCH. DO DECYZJI WŁAŚCICIELA PRZED WGRANIEM.
-- Stare anulowane rezerwacje bez powodu (cancel_reason is null, sprzed 7.11) oznaczamy jako 'superseded' tam,
-- gdzie w tym samym zleceniu powstała później nowsza rezerwacja (większe id i created_at >= updated_at starego wiersza;
-- „>=”, bo przebudowa rezerwacji anulowała i zakładała nowe w jednej transakcji, z tym samym now()) —
-- czyli stary wiersz na pewno został zastąpiony (edycja / przebudowa), a nie był ostatnim anulowaniem zlecenia.
-- Po tym reguła zapasowa w restore_order_reservations__impl nie ma już czego pomylić (dodatkowe zabezpieczenie
-- obok poprawki 20261127232000). Nic nie kasuje, nie zmienia stanów magazynu ani updated_at.
-- Zasięg policzony 27.11: 16232 wierszy w 828 zleceniach (z 901 zleceń mających takie wiersze), w tym 16 zleceń
-- anulowanych; żadne anulowane zlecenie nie traci przez to możliwości „Przywróć” (sprawdzone: 0).
-- Ostatnia paczka anulowania starego zlecenia (bez nowszych wierszy) zostaje bez zmian — „Przywróć” dalej działa.
-- NIE WGRANE.
update public.stock_reservations sr
set cancel_reason = 'superseded'
where sr.status = 'cancelled'
  and sr.cancel_reason is null
  and exists (select 1 from public.stock_reservations n
              where n.order_id = sr.order_id and n.id > sr.id and n.created_at >= sr.updated_at);
