-- Dział użytkownika: 'all' (kierownik), 'krcenter', 'bastion'
alter table public.profiles
  add column if not exists department text not null default 'krcenter';

comment on column public.profiles.department is 'Dostęp do zakładek: all | krcenter | bastion';

-- Po migracji ustaw dział dla istniejących kierowników:
-- update public.profiles set department = 'all' where role = 'manager';
