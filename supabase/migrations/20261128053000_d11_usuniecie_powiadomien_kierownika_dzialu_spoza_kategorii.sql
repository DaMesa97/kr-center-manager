-- 28.11.2026 — decyzja D11, odpowiedź właściciela: zaległe powiadomienia kierownika działu spoza jego kategorii
-- SKASOWAĆ. Wgrana 20261128031200 (punkt 5) tylko oznaczyła je jako przeczytane — zostały w historii dzwonka.
-- Tu kasujemy je na stałe, z tymi samymi kryteriami co w 031200 (bez warunku „nieprzeczytane”, bo 031200 już
-- je przeczytał):
--  * typ 'review' z link_order_id: zlecenie (orders, a gdy go nie ma — orders_archive) poza zakresem kategorii
--    kierownika (profile_order_in_scope / kategoria archiwum); nieznalezione zlecenie — zostaje;
--  * typ 'complaint': link_tab (kategoria reklamacji) spoza kategorii kierownika.
-- Inne role i inne typy powiadomień — bez zmian. Nowe powiadomienia spoza zakresu już nie powstają (031200).
-- Stan 28.11 na produkcji: 1336 powiadomień 'review' do skasowania (2 konta), 'complaint' 0.
-- Wymaga 20261128031200 (profile_order_in_scope) — na produkcji już jest.
-- DO WDROŻENIA (nie wgrane).

delete from notifications n
using profiles p
where p.id = n.user_id
  and p.role = 'kierownik_dzialu'
  and n.type = 'review'
  and n.link_order_id is not null
  and coalesce(
        (select public.profile_order_in_scope(p.id, o.id, o.category, o.linked_order_id, o.extra_fields)
         from orders o where o.id = n.link_order_id),
        (select a.category = any(coalesce(p.categories, '{}'::text[]))
         from orders_archive a where a.id = n.link_order_id),
        true
      ) = false;

delete from notifications n
using profiles p
where p.id = n.user_id
  and p.role = 'kierownik_dzialu'
  and n.type = 'complaint'
  and n.link_tab is not null
  and not (n.link_tab = any(coalesce(p.categories, '{}'::text[])));
