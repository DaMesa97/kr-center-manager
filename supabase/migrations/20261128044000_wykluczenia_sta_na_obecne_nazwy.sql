-- 28.11.2026 — decyzja właściciela (czat): 89 martwych wykluczeń konfiguratora STA przepisać na obecne nazwy słownika
-- (raport D60: „…1 mm” → „…0 mm”, LINEA 170 → LINEA 160). Wykluczenie PROFILE 120 CZARNY PATINA (id 1508) pominięte —
-- w słowniku nie ma wartości łączonej (są osobno CZARNY i PATINA); do decyzji kierownika.
-- Po przepisaniu duplikaty (ta sama para pól i wartości) są usuwane — zostaje najstarszy wpis. Audyt: trigger z 20261128010500.
-- Można uruchomić ponownie (zmienia tylko wiersze, które nadal mają starą wartość).
do $$
declare v_upd int; v_del int;
begin
  update config_exclusions e set source_value = m.nowa
  from (values
    (1502, 'LINEA 170 CZARNY', 'LINEA 160 CZARNY'),
    (1500, 'LINEA 170 CZARNY PRZYCISK', 'LINEA 160 CZARNY PRZYCISK'),
    (1503, 'LINEA 170 INOX', 'LINEA 160 INOX'),
    (1501, 'LINEA 170 INOX PRZYCISK', 'LINEA 160 INOX PRZYCISK'),
    (162, '1901 mm', '1900 mm'),
    (179, '1901 mm', '1900 mm'),
    (196, '1901 mm', '1900 mm'),
    (213, '1901 mm', '1900 mm'),
    (145, '1901 mm', '1900 mm'),
    (161, '1911 mm', '1910 mm'),
    (178, '1911 mm', '1910 mm'),
    (195, '1911 mm', '1910 mm'),
    (212, '1911 mm', '1910 mm'),
    (144, '1911 mm', '1910 mm'),
    (160, '1921 mm', '1920 mm'),
    (177, '1921 mm', '1920 mm'),
    (194, '1921 mm', '1920 mm'),
    (211, '1921 mm', '1920 mm'),
    (143, '1921 mm', '1920 mm'),
    (159, '1931 mm', '1930 mm'),
    (176, '1931 mm', '1930 mm'),
    (193, '1931 mm', '1930 mm'),
    (210, '1931 mm', '1930 mm'),
    (142, '1931 mm', '1930 mm'),
    (158, '1941 mm', '1940 mm'),
    (175, '1941 mm', '1940 mm'),
    (192, '1941 mm', '1940 mm'),
    (209, '1941 mm', '1940 mm'),
    (141, '1941 mm', '1940 mm'),
    (157, '1951 mm', '1950 mm'),
    (174, '1951 mm', '1950 mm'),
    (191, '1951 mm', '1950 mm'),
    (208, '1951 mm', '1950 mm'),
    (140, '1951 mm', '1950 mm'),
    (156, '1961 mm', '1960 mm'),
    (173, '1961 mm', '1960 mm'),
    (190, '1961 mm', '1960 mm'),
    (207, '1961 mm', '1960 mm'),
    (139, '1961 mm', '1960 mm'),
    (155, '1971 mm', '1970 mm'),
    (172, '1971 mm', '1970 mm'),
    (189, '1971 mm', '1970 mm'),
    (206, '1971 mm', '1970 mm'),
    (138, '1971 mm', '1970 mm'),
    (154, '1981 mm', '1980 mm'),
    (171, '1981 mm', '1980 mm'),
    (188, '1981 mm', '1980 mm'),
    (205, '1981 mm', '1980 mm'),
    (137, '1981 mm', '1980 mm'),
    (153, '1991 mm', '1990 mm'),
    (170, '1991 mm', '1990 mm'),
    (187, '1991 mm', '1990 mm'),
    (204, '1991 mm', '1990 mm'),
    (136, '1991 mm', '1990 mm'),
    (152, '2001 mm', '2000 mm'),
    (169, '2001 mm', '2000 mm'),
    (186, '2001 mm', '2000 mm'),
    (203, '2001 mm', '2000 mm'),
    (135, '2001 mm', '2000 mm'),
    (151, '2011 mm', '2010 mm'),
    (168, '2011 mm', '2010 mm'),
    (185, '2011 mm', '2010 mm'),
    (202, '2011 mm', '2010 mm'),
    (134, '2011 mm', '2010 mm'),
    (150, '2021 mm', '2020 mm'),
    (167, '2021 mm', '2020 mm'),
    (184, '2021 mm', '2020 mm'),
    (201, '2021 mm', '2020 mm'),
    (133, '2021 mm', '2020 mm'),
    (149, '2031 mm', '2030 mm'),
    (166, '2031 mm', '2030 mm'),
    (183, '2031 mm', '2030 mm'),
    (200, '2031 mm', '2030 mm'),
    (132, '2031 mm', '2030 mm'),
    (148, '2041 mm', '2040 mm'),
    (165, '2041 mm', '2040 mm'),
    (182, '2041 mm', '2040 mm'),
    (199, '2041 mm', '2040 mm'),
    (131, '2041 mm', '2040 mm'),
    (147, '2051 mm', '2050 mm'),
    (164, '2051 mm', '2050 mm'),
    (181, '2051 mm', '2050 mm'),
    (198, '2051 mm', '2050 mm'),
    (130, '2051 mm', '2050 mm'),
    (146, '2061 mm', '2060 mm'),
    (163, '2061 mm', '2060 mm'),
    (180, '2061 mm', '2060 mm'),
    (197, '2061 mm', '2060 mm'),
    (129, '2061 mm', '2060 mm')
  ) m(id, stara, nowa)
  where e.id = m.id and e.source_value = m.stara;
  get diagnostics v_upd = row_count;
  delete from config_exclusions e
  using config_exclusions k
  where e.category = k.category and e.source_field = k.source_field and e.source_value = k.source_value
    and e.target_field = k.target_field and e.target_value = k.target_value and e.id > k.id
    and e.id in (1502, 1500, 1503, 1501, 162, 179, 196, 213, 145, 161, 178, 195, 212, 144, 160, 177, 194, 211, 143, 159, 176, 193, 210, 142, 158, 175, 192, 209, 141, 157, 174, 191, 208, 140, 156, 173, 190, 207, 139, 155, 172, 189, 206, 138, 154, 171, 188, 205, 137, 153, 170, 187, 204, 136, 152, 169, 186, 203, 135, 151, 168, 185, 202, 134, 150, 167, 184, 201, 133, 149, 166, 183, 200, 132, 148, 165, 182, 199, 131, 147, 164, 181, 198, 130, 146, 163, 180, 197, 129);
  get diagnostics v_del = row_count;
  raise notice 'wykluczenia: przepisano %, usunięto duplikatów %', v_upd, v_del;
end $$;
