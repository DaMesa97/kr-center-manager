-- 28.11.2026 — WGRANE na polecenie właściciela („Tak, oba”): usunięcie klientów, którzy powstali WYŁĄCZNIE z nieodebranych
-- połączeń z nowego numeru (od crm-call-ingest v25 takie połączenie nie zakłada już klienta).
-- Kryteria: status 'nowy', źródło telefon, bez zadania i wartości, bez ofert, dokumentów, maili, zamówień sklepu,
-- bez żadnej ręcznej akcji (zdarzenie z „kto”), a każda rozmowa to nieodebrana przychodząca.
-- Kopia w crm.porzadek_bez_potencjalu_kopia (z 20261128060100); rozmowy i ich zdarzenia odpięte (lista „Bez potencjału
-- sprzedaży”), dopiero potem klient usuwany (rozmowy.lead_id ma ON DELETE CASCADE). Bezpiecznik: > 10 kandydatów przerywa.
do $porzadek$
declare
  ids uuid[];
  n_roz int;
  n_zd int;
begin
  select coalesce(array_agg(l.id), '{}') into ids
  from crm.leady l
  where l.status = 'nowy' and l.zrodlo = 'telefon' and l.nastepna_akcja is null and coalesce(l.wartosc_szac, 0) = 0
    and not exists (select 1 from crm.oferty o where o.lead_id = l.id)
    and not exists (select 1 from crm.dokumenty d where d.lead_id = l.id)
    and not exists (select 1 from crm.maile m where m.lead_id = l.id)
    and not exists (select 1 from crm.zamowienia_sklep z where z.lead_id = l.id)
    and not exists (select 1 from crm.zdarzenia e where e.lead_id = l.id and e.kto is not null)
    and exists (select 1 from crm.rozmowy r where r.lead_id = l.id)
    and not exists (select 1 from crm.rozmowy r where r.lead_id = l.id
                    and (r.odebrana is distinct from false or r.kierunek <> 'przychodzaca'));

  if cardinality(ids) = 0 then
    raise notice 'Porządek: brak klientów tylko z nieodebranych.';
    return;
  end if;
  if cardinality(ids) > 10 then
    raise exception 'Porządek przerwany: % kandydatów (bezpiecznik 10).', cardinality(ids);
  end if;

  insert into crm.porzadek_bez_potencjalu_kopia select l.*, now() from crm.leady l where l.id = any (ids);

  update crm.zdarzenia z set lead_id = null
   where z.lead_id = any (ids) and z.dane->>'rozmowa_id' is not null;
  get diagnostics n_zd = row_count;

  update crm.rozmowy r
     set lead_id = null,
         podsumowanie = case when coalesce(r.podsumowanie, '') like '%bez klienta%' then r.podsumowanie
                             else 'Nieodebrana przychodząca z nowego numeru (bez klienta).' end
   where r.lead_id = any (ids);
  get diagnostics n_roz = row_count;

  delete from crm.leady l where l.id = any (ids);

  insert into crm.zdarzenia (lead_id, typ, opis, dane)
  values (null, 'porzadek',
          format('Porządek 28.11: usunięto %s klientów założonych tylko z nieodebranych połączeń; %s rozmów odpięto.', cardinality(ids), n_roz),
          jsonb_build_object('lead_ids', to_jsonb(ids), 'rozmow', n_roz, 'zdarzen_odpietych', n_zd, 'kopia', 'crm.porzadek_bez_potencjalu_kopia'));

  raise notice 'Porządek: usunięto % klientów, odpięto % rozmów i % zdarzeń.', cardinality(ids), n_roz, n_zd;
end
$porzadek$;
