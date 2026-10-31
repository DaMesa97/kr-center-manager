import sys, io, json, datetime, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
import openpyxl

xl = sys.argv[1]
app_path = sys.argv[2]
out_sql = sys.argv[3]

raw = io.open(app_path, encoding="utf-8-sig").read().strip()
app = json.loads(raw) if raw else []
print("zlecen w aplikacji (otwarte, nie-bot):", len(app))

wb = openpyxl.load_workbook(xl, data_only=True, read_only=True)
SHEETS = {
    'Zamowienia Center': ('CENTER', False),
    'Zamowienia Profil': ('PROFIL', False),
    'Zamowienia Bold Center': ('CENTER', True),
    'Zamowienia Bold Profil': ('PROFIL', True),
    'Zamowienia Center INTERIOR': ('CENTER', False),
    'Zamowienia Profil INTERIOR': ('PROFIL', False),
}
rows = []  # (sheet, wyk, bold, number, date, firma, system, height, frame, width)
for name, (wyk, bold) in SHEETS.items():
    ws = wb[name]
    it = ws.iter_rows(values_only=True)
    hdr = next(it)
    idx = {h: i for i, h in enumerate(hdr) if h}
    ci = lambda k: idx.get(k)
    for r in it:
        num = r[ci('NUMER ZLECENIA')]
        if num is None:
            continue
        d = r[ci('DATA')]
        h = r[ci('WYSOKOŚĆ (192 CALK SKRZ - ZAMKI WYŻEJ 12 CM')]
        rows.append({
            'sheet': name, 'wyk': wyk, 'bold': bold,
            'num': str(num).replace('AUTO ', '').strip(),
            'date': d.date().isoformat() if isinstance(d, datetime.datetime) else str(d)[:10] if d else '',
            'firma': str(r[ci('FIRMA')] or '').strip(),
            'system': str(r[ci('SYSTEM')] or '').strip(),
            'height': str(h).strip() if h not in (None, '') else '',
            'frame': str((r[ci('OŚCIEŻNICA')] if ci('OŚCIEŻNICA') is not None else (r[ci('ZABUDOWA')] if ci('ZABUDOWA') is not None else '')) or '').strip(),
            'width': str(r[ci('SZEROKOŚĆ')] or '').strip(),
        })
print("wierszy w arkuszach:", len(rows))
by_num = collections.defaultdict(list)
for r in rows:
    by_num[r['num']].append(r)

def norm(s):
    return ' '.join(str(s or '').upper().split())

matched, ambiguous, missing = [], [], []
for o in app:
    cands = by_num.get(str(o['order_number']).strip(), [])
    wyk = norm(o['wykonawca'])
    is_bold = norm(o['system']).startswith('BOLD')
    # 1) numer + data + system
    c1 = [c for c in cands if c['date'] == o['order_date'] and norm(c['system']) == norm(o['system'])]
    if len(c1) != 1:
        # 2) numer + data + firma (pierwsze słowo)
        fw = norm(o['company']).split(' ')[0] if o['company'] else ''
        c1 = [c for c in cands if c['date'] == o['order_date'] and fw and norm(c['firma']).startswith(fw)]
    if len(c1) != 1:
        # 3) numer + arkusz wg wykonawcy/bold + data
        c1 = [c for c in cands if c['date'] == o['order_date'] and c['bold'] == is_bold and (not wyk or c['wyk'] in wyk or wyk in c['wyk'])]
    if len(c1) == 1:
        matched.append((o, c1[0]))
    elif len(c1) > 1:
        ambiguous.append((o, c1))
    else:
        missing.append(o)

print("dopasowane:", len(matched), "niejednoznaczne:", len(ambiguous), "brak w arkuszu:", len(missing))
empty_app = [m for m in matched if not m[0]['height']]
print("dopasowane z pustą wysokością w aplikacji:", len(empty_app))
with_sheet_h = [m for m in empty_app if m[1]['height']]
print("  z czego arkusz ma wysokość:", len(with_sheet_h))
hc = collections.Counter(m[1]['height'] for m in with_sheet_h)
print("  rozkład wysokości z arkusza (top 15):", hc.most_common(15))
# rozbieżności tam, gdzie aplikacja ma wysokość
diff = [(m[0]['order_number'], m[0]['height'], m[1]['height']) for m in matched if m[0]['height'] and m[1]['height'] and norm(m[0]['height']) != norm(m[1]['height'])]
print("aplikacja ma wysokość inną niż arkusz:", len(diff), diff[:8])
print("przykłady brak w arkuszu:", [(o['order_number'], o['order_date'], o['system'], o['company'][:20]) for o in missing[:8]])
print("przykłady niejednoznaczne:", [(o['order_number'], o['order_date'], [c['sheet'] for c in cs]) for o, cs in ambiguous[:5]])

# SQL: tylko dopasowane 1:1 z pustą wysokością w aplikacji i niepustą w arkuszu
def q(s):
    return "'" + s.replace("'", "''") + "'"
lines = ["-- wysokości z arkusza Excel dla otwartych zleceń Bastion z importu (dopasowanie numer+data+system/firma)",
         "begin;",
         "create temp table h_fix (id bigint primary key, order_number text, height text);",
         "insert into h_fix values"]
vals = [f"({m[0]['id']}, {q(str(m[0]['order_number']))}, {q(m[1]['height'])})" for m in with_sheet_h]
lines.append(",\n".join(vals) + ";")
lines.append("update orders o set height = f.height from h_fix f where f.id = o.id and o.category = 'Bastion' and coalesce(o.height, '') = '';")
lines.append("insert into audit_log (table_name, record_id, operation, user_id, new_data) select 'orders', f.id::text, 'UPDATE', null, jsonb_build_object('action', 'bastion_height_from_excel', 'order_number', f.order_number, 'height', f.height) from h_fix f;")
lines.append("select count(*) as uzupelnione from orders o join h_fix f on f.id = o.id where o.height = f.height;")
lines.append("commit;")
io.open(out_sql, 'w', encoding='utf-8', newline='\n').write("\n".join(lines))
print("sql:", out_sql, "wierszy:", len(vals))
