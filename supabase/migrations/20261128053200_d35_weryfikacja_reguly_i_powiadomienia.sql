-- 28.11.2026 — decyzja D35 (właściciel: TAK — najpierw (b) przegląd reguł ostrzeżeń, potem (a) priorytety + ukrywanie
-- starych). Weryfikacja zalana: 462 otwarte pozycje, ok. 1000 powiadomień „do weryfikacji” tygodniowo.
-- Przegląd reguł na produkcji (28.11):
--   * „Numer N z arkusza był już zajęty (…) — nadano numer M” (Excel): 418 z 462 otwartych (90%), ok. 175 tygodniowo;
--     z tego 325 to kolizja z zleceniem INNEJ firmy — zwykła kolizja puli numerów (bot i arkusz numerują w tej samej
--     puli), nie problem do sprawdzenia; numer z arkusza i tak widać na plakietce „ark. N”.
--   * bot: „Możliwy duplikat …” 20, „Brak numeru zamówienia klienta” 16, „identyczny payload” 10 — zostają.
--   * 1503 nieprzeczytane powiadomienia „do weryfikacji” dotyczą zleceń już zweryfikowanych (flaga zdjęta) —
--     powiadomienie nie gasło po weryfikacji.
-- Zmiany:
--  1) Funkcja Edge orders-excel-intake (w repo, wdrożenie osobno): kolizja numeru z inną firmą → bez flagi
--     Weryfikacji (tylko sheet_number_conflict); z tą samą firmą → Weryfikacja jak dotąd.
--  2) Tu, wstecznie ta sama reguła: otwarte pozycje z Excela, których jedynym powodem jest zajęty numer, a zlecenie
--     z tym numerem (ta sama kategoria) jest innej firmy → zdjęcie flagi tak jak „Oznacz jako zweryfikowane”
--     (original_warnings / original_needs_review zostają, verified_note = 'D35: …', verified_by puste).
--     Porównanie firm jak companiesMatch w funkcji Edge (słowa krótszej nazwy zawarte w dłuższej).
--     Nieznalezione zlecenie z numerem albo ta sama firma — zostają w Weryfikacji.
--  3) Trigger trg_orders_review_notifications_read: gdy zlecenie wychodzi z Weryfikacji (needs_review true → nie
--     true), jego nieprzeczytane powiadomienia 'review' (u wszystkich) → przeczytane.
--  4) Porządek: istniejące nieprzeczytane powiadomienia 'review' zleceń bez flagi → przeczytane (nie kasujemy).
-- Stan 28.11 (test w transakcji cofanej): patrz raport D35.
-- DO WDROŻENIA (nie wgrane).

-- 3) trigger: weryfikacja gasi powiadomienia
create or replace function public.orders_review_notifications_read()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- D35: zlecenie wyszło z Weryfikacji — powiadomienia „do weryfikacji” przestają wisieć w dzwonkach
  update notifications
  set is_read = true
  where type = 'review'
    and link_order_id = NEW.id
    and is_read = false;
  return NEW;
end;
$function$;

revoke all on function public.orders_review_notifications_read() from public, anon, authenticated;

drop trigger if exists trg_orders_review_notifications_read on public.orders;
create trigger trg_orders_review_notifications_read
  after update of extra_fields on public.orders
  for each row
  when ((old.extra_fields->>'needs_review') = 'true' and (new.extra_fields->>'needs_review') is distinct from 'true')
  execute function public.orders_review_notifications_read();

-- 2) wstecznie: kolizja numeru z inną firmą — bez Weryfikacji
with kand as (
  select o.id, o.category, o.company, o.extra_fields->>'sheet_number_conflict' as nr
  from orders o
  where o.source = 'excel'
    and o.extra_fields->>'needs_review' = 'true'
    and coalesce(o.extra_fields->>'sheet_number_conflict', '') <> ''
    and jsonb_typeof(o.extra_fields->'warnings') = 'array'
    and jsonb_array_length(o.extra_fields->'warnings') > 0
    and not exists (
      select 1 from jsonb_array_elements(o.extra_fields->'warnings') w
      where coalesce(w#>>'{}', '') not like 'Numer % z arkusza był już zajęty%'
    )
),
tokeny as (
  select k.id,
         array_remove(regexp_split_to_array(upper(trim(coalesce(k.company, ''))), '[\s#,]+'), '') as t_nowe,
         e.id as e_id,
         array_remove(regexp_split_to_array(upper(trim(coalesce(e.company, ''))), '[\s#,]+'), '') as t_stare
  from kand k
  join orders e on e.category = k.category and e.order_number = k.nr and e.id <> k.id
),
do_zdjecia as (
  select t.id
  from tokeny t
  group by t.id
  -- żadne zlecenie z tym numerem nie jest tej samej firmy (pusta nazwa = „może ta sama” → zostaje)
  having bool_and(
           cardinality(t.t_nowe) > 0 and cardinality(t.t_stare) > 0
           and not (t.t_nowe <@ t.t_stare or t.t_stare <@ t.t_nowe)
         )
)
update orders o
set extra_fields = o.extra_fields || jsonb_build_object(
      'needs_review', false,
      'warnings', '[]'::jsonb,
      'original_warnings', coalesce(o.extra_fields->'warnings', '[]'::jsonb),
      'original_needs_review', true,
      'verified_at', now(),
      'verified_note', 'D35: numer z arkusza zajęty przez zlecenie innej firmy — tylko informacja (plakietka „ark.”)'
    )
from do_zdjecia d
where o.id = d.id;

-- 4) zaległe powiadomienia zleceń już zweryfikowanych → przeczytane
update notifications n
set is_read = true
from orders o
where o.id = n.link_order_id
  and n.type = 'review'
  and n.is_read = false
  and (o.extra_fields->>'needs_review') is distinct from 'true';
