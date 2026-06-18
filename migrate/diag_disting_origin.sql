-- Skąd pochodzą wiersze "Disting" i jakie mają systemy
-- 1) Rozkład systemów wśród Disting
select system, count(*) as ile
from orders
where category = 'Disting'
group by system
order by ile desc;

-- 2) Czy Disting mają wykonawcę (Center/Profil/WZ) = pochodzą z arkuszy STA
select coalesce(extra_fields->>'wykonawca', '(brak)') as wykonawca, count(*) as ile
from orders
where category = 'Disting'
group by 1
order by ile desc;

-- 3) Rozkład systemów wśród STA (czy są tam DISTING PLUS, które powinny linkować)
select system, count(*) as ile
from orders
where category = 'STA'
group by system
order by ile desc
limit 20;
