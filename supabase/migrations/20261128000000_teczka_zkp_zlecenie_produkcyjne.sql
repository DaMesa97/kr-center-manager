-- Teczka ZKP: pozycja „Zlecenie produkcyjne (zał. 6.30)” nie miała gałęzi w CASE,
-- więc zawsze była „brak” i trigger alu_block_release_incomplete_dossier blokował
-- wydanie KAŻDEGO zlecenia ZKP. Testy 28.11 (runda 8, ZKP).
-- Teraz: „jest”, gdy zlecenie zostało uruchomione do produkcji (etap C — wiersz
-- w alu_production_orders, nadany numer ZZ). Reszta funkcji bez zmian.
create or replace function public.alu_dossier_status(p_order_id bigint)
 returns table(r_sort integer, r_item_key text, r_label text, r_status text, r_detail text, r_document_id bigint, r_na_id bigint, r_at timestamp with time zone, r_by text, r_na_allowed boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with cur as (
    select distinct on (d.kind) d.*
    from public.order_documents d
    where d.order_id = p_order_id and d.withdrawn_at is null
    order by d.kind, d.version desc
  ),
  na as (
    select n.* from public.zkp_dossier_na n
    where n.order_id = p_order_id and n.withdrawn_at is null
  ),
  -- testy 28.11 (runda 8, ZKP): zlecenie produkcyjne = uruchomienie do produkcji (etap C)
  prod as (
    select po.* from public.alu_production_orders po where po.order_id = p_order_id
  ),
  cards as (
    select count(*) as total,
           count(*) filter (where c.decision = 'zwolniony') as released,
           count(*) filter (where c.decision = 'zwolniony' and exists (
             select 1 from public.zkp_test_protocols p where p.card_id = c.id and p.decision = 'zwolniony')) as with_protocol,
           count(*) filter (where coalesce(c.declaration_no, '') <> '') as with_declaration,
           max(c.decided_at) as last_at,
           (array_agg(c.decided_by_name order by c.decided_at desc nulls last))[1] as last_by,
           string_agg(distinct c.declaration_no, ', ') filter (where coalesce(c.declaration_no, '') <> '') as declarations
    from public.alu_constructions k
    left join public.zkp_product_cards c on c.construction_id = k.id
    where k.order_id = p_order_id and k.status = 'aktywna'
  ),
  lots as (
    select count(distinct x.lot_id) as n
    from public.zkp_product_cards c
    join lateral (
      select s.lot_id from public.zkp_card_stage_records s where s.card_id = c.id and s.lot_id is not null
      union all select h.lot_id from public.zkp_card_hardware h where h.card_id = c.id and h.lot_id is not null
      union all select f.lot_id from public.zkp_card_fillings f where f.card_id = c.id and f.lot_id is not null
    ) x on true
    where c.order_id = p_order_id
  ),
  cd as (
    select (cards.total > 0 and cards.released = cards.total) as done,
           (cards.total > 0 and cards.with_protocol = cards.total) as protocols_done,
           (cards.total > 0 and cards.with_declaration = cards.total) as declarations_done,
           cards.* from cards
  ),
  items(sort, key, label, kinds, na_allowed, generated_in) as (values
    (1,  'zamowienie_klienta',      'Zamówienie klienta',                       array['ZK'],         true,  null),
    (2,  'zlecenie_produkcyjne',    'Zlecenie produkcyjne (zał. 6.30)',          array[]::text[],     false, 'etap C'),
    (3,  'lista_ciec',              'Lista cięć',                                array['LC'],         false, null),
    (4,  'zestawienie_materialowe', 'Zestawienie materiałowe (Lista produkcyjna)', array['LP'],       false, null),
    (5,  'zamowienia_materialow',   'Zamówienia materiałów (szkło, profile, okucia)', array['ZM','ZMAT'], true, null),
    (6,  'przyjecia_pz',            'Dokumenty przyjęcia do magazynu (PZ)',      array[]::text[],     false, 'karty wyrobu'),
    (7,  'wydania_rw',              'Wydania materiałów na zlecenie (RW, partie)', array[]::text[],   false, 'karty wyrobu'),
    (8,  'karta_wyrobu',            'Karta wyrobu (zał. 6.25)',                  array[]::text[],     false, 'karty wyrobu'),
    (9,  'protokol_badan',          'Protokół badań wyrobu gotowego (zał. 6.17.5)', array[]::text[],  false, 'protokoły'),
    (10, 'deklaracja',              'Deklaracja KDWU / DWU',                     array[]::text[],     false, 'deklaracje'),
    (11, 'protokol_montazu',        'Protokół montażu (zał. 6.28)',              array['MONT'],       true,  null)
  )
  select i.sort, i.key, i.label,
         case when doc.id is not null then 'jest'
              when n.id is not null then 'nie_dotyczy'
              when i.key = 'zlecenie_produkcyjne' and pr.id is not null then 'jest'
              when i.key in ('przyjecia_pz', 'wydania_rw', 'karta_wyrobu') and cd.done then 'jest'
              when i.key = 'protokol_badan' and cd.protocols_done then 'jest'
              when i.key = 'deklaracja' and cd.declarations_done then 'jest'
              else 'brak' end,
         case when doc.id is not null then
                doc.kind || ' v' || doc.version || ' · ' || doc.file_name
                || coalesce(' · ' || doc.number, '')
              when n.id is not null then n.reason
              when i.key = 'zlecenie_produkcyjne' and pr.id is not null then
                'ZZ ' || pr.zz || '/' || pr.year || ' — uruchomione do produkcji'
              when i.key = 'karta_wyrobu' then 'zwolnione karty: ' || cd.released || ' / ' || cd.total
              when i.key = 'protokol_badan' then 'protokoły zwolnione: ' || cd.with_protocol || ' / ' || cd.total
              when i.key = 'deklaracja' then coalesce(cd.declarations || ' · ', '') || 'konstrukcje z deklaracją: ' || cd.with_declaration || ' / ' || cd.total
              when i.key in ('przyjecia_pz', 'wydania_rw') then
                case when cd.done then 'partie w kartach wyrobu: ' || (select lots.n from lots) || ' (rejestr przyjęć 6.24)'
                     else 'z kart wyrobu — zwolnione ' || cd.released || ' / ' || cd.total end
              when i.generated_in is not null then 'generowane przez program — ' || i.generated_in
              else '' end,
         doc.id, n.id,
         coalesce(doc.uploaded_at, n.created_at,
                  case when i.key = 'zlecenie_produkcyjne' then pr.started_at end,
                  case when i.key in ('przyjecia_pz', 'wydania_rw', 'karta_wyrobu', 'protokol_badan', 'deklaracja') and cd.done then cd.last_at end),
         coalesce(nullif(doc.uploaded_by_name, ''), n.created_by_name,
                  case when i.key = 'zlecenie_produkcyjne' then nullif(pr.started_by_name, '') end,
                  case when i.key in ('przyjecia_pz', 'wydania_rw', 'karta_wyrobu', 'protokol_badan', 'deklaracja') and cd.done then cd.last_by end),
         i.na_allowed
  from items i
  cross join cd
  left join prod pr on true
  left join lateral (
    select c.* from cur c where c.kind = any(i.kinds) order by c.uploaded_at desc limit 1
  ) doc on true
  left join na n on n.item_key = i.key
  order by i.sort;
$function$;
