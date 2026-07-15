-- =====================================================================
-- FIX PO MIGRACJI RÓL (2026-07-04) — WYKONANE.
-- Stare polityki RLS (37 polityk / 26 tabel: magazyn, konfiguracja,
-- reklamacje, api_keys, audyt, worker_stages…) sprawdzały role='manager'.
-- Po migracji manager→admin wszystkie zapisy wywalały RLS violation
-- (np. "new row violates row-level security policy for table suppliers").
--
-- Ten skrypt przepisuje WSZYSTKIE polityki zawierające 'manager' tak,
-- by akceptowały też admin + kierownik_*. Idempotentny (można powtórzyć).
-- Obsługuje oba wzorce: role = 'manager' oraz role = ANY(ARRAY['manager',...]).
-- =====================================================================

do $$
declare
  p record;
  new_qual text;
  new_check text;
  stmt text;
  kier constant text := '''admin''::text, ''kierownik_dzialu''::text, ''kierownik_magazynu''::text, ''kierownik_produkcji''::text, ''kierownik_firmowy''::text';
begin
  for p in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') like '%''manager''%' or coalesce(with_check,'') like '%''manager''%')
  loop
    new_qual := p.qual;
    new_check := p.with_check;

    new_qual  := replace(new_qual,  'ARRAY[''manager''::text', 'ARRAY[''manager''::text, ' || kier);
    new_check := replace(new_check, 'ARRAY[''manager''::text', 'ARRAY[''manager''::text, ' || kier);
    new_qual  := replace(new_qual,  '= ''manager''::text', '= any (array[''manager''::text, ' || kier || '])');
    new_check := replace(new_check, '= ''manager''::text', '= any (array[''manager''::text, ' || kier || '])');

    stmt := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if p.qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if p.with_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;

    execute stmt;
    raise notice 'Naprawiono: %.%', p.tablename, p.policyname;
  end loop;
end $$;

-- Diagnostyka (które polityki odwołują się do konkretnej roli):
-- select tablename, policyname, cmd from pg_policies
-- where schemaname='public'
--   and (coalesce(qual,'') like '%''NAZWA_ROLI''%' or coalesce(with_check,'') like '%''NAZWA_ROLI''%');
