"""
Skrypt migracyjny: Zamówienia STA/Disting → Supabase
=====================================================
Czyta .env z katalogu projektu (../), wstawia zamówienia partiami.

Źródło: Zamówienia STA do nowej apki.xlsm
Arkusze: Zamowienia Profil, Zamowienia Center, Zamowienia WZ

Uruchomienie:
    cd migrate
    python migrate_sta.py

Wymagania:
    pip install pandas openpyxl python-dotenv requests
"""

import os, sys, json, math, warnings, re
from datetime import datetime
import pandas as pd
import requests

warnings.filterwarnings('ignore')

# ── Konfiguracja ──────────────────────────────────────────────────────────────

EXCEL_PATH = r'C:\Users\mrpro\OneDrive\Pulpit\Zamówienia STA do nowej apki.xlsm'
BATCH_SIZE = 50

# Wczytaj .env z katalogu projektu
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# Czytaj URL z supabaseClient.ts jeśli nie ma w .env
SUPABASE_URL = os.environ.get('VITE_SUPABASE_URL', '')
if not SUPABASE_URL:
    client_path = os.path.join(os.path.dirname(__file__), '..', 'src', 'supabaseClient.ts')
    if os.path.exists(client_path):
        with open(client_path) as f:
            for line in f:
                m = re.search(r"['\"]https://[^'\"]+supabase\.co['\"]", line)
                if m:
                    SUPABASE_URL = m.group(0).strip("'\"")
                    break

SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("BŁĄD: Nie znaleziono konfiguracji Supabase.")
    print(f"  URL: {'OK' if SUPABASE_URL else 'BRAK'}")
    print(f"  KEY: {'OK' if SUPABASE_KEY else 'BRAK - dodaj SUPABASE_SERVICE_ROLE_KEY do .env'}")
    sys.exit(1)

HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
}

# ── Helpery ───────────────────────────────────────────────────────────────────

EMPTY_STAGE_VALS = {'-', '---', '----', '', ' ', 'nan', 'none'}

def stage_val(v) -> str:
    """Konwertuje wartość etapu z Excela → 'X' jeśli wypełniony, '' jeśli pusty."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ''
    s = str(v).strip()
    return '' if s.lower() in EMPTY_STAGE_VALS else 'X'

def clean_str(v, default='') -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return default
    s = str(v).strip()
    return s if s.lower() not in ('nan', 'none', '-') else default

def clean_date(v) -> str | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if isinstance(v, datetime):
        return v.strftime('%Y-%m-%d')
    s = str(v).strip()
    if not s or s.lower() in ('nan', '-', 'none'):
        return None
    try:
        return pd.to_datetime(s).strftime('%Y-%m-%d')
    except Exception:
        return None

def clean_sequence(v) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ''
    s = str(v).strip().upper()
    if s in ('ANULOWANE', 'PRZENIESIONE CENTER', 'PRZENIESIONE PROFIL', '?', '-', 'NAN', 'NONE'):
        return ''
    return s

def determine_category(system: str) -> str:
    s = str(system).strip().upper()
    if 'DISTING' in s:
        return 'Disting'
    return 'STA'

def build_production_stages(row, category: str) -> dict:
    base = {
        'e1': stage_val(row.get('ETAP 1')),
        'e2_1': stage_val(row.get('ETAP 2.1')),
        'e2_2': stage_val(row.get('ETAP 2.2')),
        'e3': stage_val(row.get('ETAP 3')),
        'e4': stage_val(row.get('ERAP 4')),
        'e5': stage_val(row.get('ETAP 5')),
    }
    if category == 'Disting':
        base.update({
            'dist_e1': '',
            'dist_e5': '',
            'dist_e2_1': '',
            'dist_e2_2': '',
        })
    return base

def map_row(row: dict, wykonawca: str) -> dict:
    system = clean_str(row.get('SYSTEM'))
    category = determine_category(system)

    seq_raw = row.get('KOLEJNOŚĆ') or row.get('KOLEJNOSC') or ''
    seq_str = str(seq_raw).strip().upper() if seq_raw else ''
    is_cancelled = seq_str in ('ANULOWANE',)
    sequence = clean_sequence(seq_raw)

    extra_fields: dict = {'wykonawca': wykonawca}
    if is_cancelled:
        extra_fields['cancelled'] = True
        extra_fields['cancelled_at'] = ''
        extra_fields['cancelled_by'] = 'migracja'

    braki = clean_str(row.get('BRAKI'))
    if braki:
        extra_fields['braki'] = braki

    wpisał = clean_str(row.get('WPISAŁ') or row.get('WPISAL'))
    if wpisał:
        extra_fields['entered_by'] = wpisał

    nr_zlecenia = row.get('NR. ZLECENIA') or row.get('NR ZLECENIA') or ''
    try:
        order_number = str(int(float(str(nr_zlecenia)))) if nr_zlecenia else ''
    except (ValueError, TypeError):
        order_number = clean_str(nr_zlecenia)

    order_date_raw = row.get('DATA')
    order_date = clean_date(order_date_raw) or datetime.today().strftime('%Y-%m-%d')

    release_date = clean_date(row.get('WYDANIE'))

    qty_raw = row.get('ILOŚĆ') or row.get('ILOSC') or 1
    try:
        quantity = int(float(str(qty_raw))) if qty_raw else 1
    except (ValueError, TypeError):
        quantity = 1

    konfigurator_raw = row.get('WARTOŚĆ KONFIGURATOR') or row.get('WARTOŚĆ KONFIGURACJI') or row.get('WARTOSC KONFIGURATOR')
    try:
        configurator_value = float(str(konfigurator_raw)) if konfigurator_raw and str(konfigurator_raw).strip() not in ('nan', 'none', '-', '') else None
    except (ValueError, TypeError):
        configurator_value = None

    nr_disting = clean_str(row.get('NR. W ARKUSZU DISTING') or row.get('NR W ARKUSZU DISTING'))
    disting_sheet = nr_disting if nr_disting else ''

    return {
        'order_number': order_number,
        'company': clean_str(row.get('FIRMA')),
        'order_date': order_date,
        'production_day': clean_str(row.get('PRODUKCJA')),
        'quantity': quantity,
        'sequence': sequence,
        'system': system,
        'model': clean_str(row.get('MODEL')),
        'wing_color': clean_str(row.get('KOLOR SKRZYDŁA') or row.get('KOLOR SKRZYDLA')),
        'frame_color': clean_str(row.get('KOLOR OŚCIEZNICY') or row.get('KOLOR OSCIEZNICY')),
        'threshold_color': clean_str(row.get('KOLOR PROGU')),
        'width': clean_str(row.get('SZEROKOŚĆ') or row.get('SZEROKOSC')),
        'direction': clean_str(row.get('KIERUNEK')),
        'opening': clean_str(row.get('OTWIERANIE')),
        'height': clean_str(row.get('WYSOKOŚĆ') or row.get('WYSOKOSC')),
        'glazing': clean_str(row.get('SZKLENIE')),
        'decorative_panel': clean_str(row.get('PANEL DEKORACYJNY')),
        'hardware': clean_str(row.get('OKUCIA')),
        'handle': clean_str(row.get('POCHWYT')),
        'electric_strike': clean_str(row.get('ELEKTROZACZEP')),
        'peephole': clean_str(row.get('WIZJER')),
        'top_light': clean_str(row.get('NAŚWIETLE GÓRNE') or row.get('NASWIETLE GORNE') or row.get('NAŚWIETL')),
        'top_light_glazing': clean_str(row.get('SZKLENIE NAŚWIETLE GÓRNE') or row.get('SZKLENIE NASWIETLE GORNE')),
        'side_panel': clean_str(row.get('DOSTAWKA BOCZNA')),
        'side_panel_glazing': clean_str(row.get('SZKLENIE DOSTAWKA BOCZNA')),
        'extension': clean_str(row.get('POSZERZENIE')),
        'release_date': release_date,
        'notes': clean_str(row.get('UWAGI')),
        'client_order_number': clean_str(row.get('NUMER ZAMÓWIENIA KLIENTA') or row.get('NUMER ZAMOWIENIA KLIENTA')),
        'info': clean_str(row.get('INFO')),
        'airtable_id': clean_str(row.get('AIRTABLE ID')),
        'label': clean_str(row.get('ETYKIETA')),
        'disting_sheet': disting_sheet,
        'configurator_value': configurator_value,
        'source': 'migracja',
        'category': category,
        'production_stages': build_production_stages(row, category),
        'extra_fields': extra_fields,
    }

def insert_batch(records: list) -> tuple[int, list]:
    """Wstawia partię rekordów. Zwraca (liczba_ok, błędy)."""
    resp = requests.post(
        f'{SUPABASE_URL}/rest/v1/orders',
        headers=HEADERS,
        data=json.dumps(records),
    )
    if resp.status_code in (200, 201):
        return len(records), []
    else:
        return 0, [f'HTTP {resp.status_code}: {resp.text[:200]}']

def read_sheet(path: str, sheet: str, wykonawca: str) -> list[dict]:
    """Wczytuje arkusz i konwertuje wiersze."""
    print(f'  Czytam: {sheet} ({wykonawca})...')

    df = pd.read_excel(path, sheet_name=sheet, engine='openpyxl')

    # Normalizuj nazwy kolumn (usuń znaki spec, spacje)
    col_map = {}
    for c in df.columns:
        normalized = c.strip()
        col_map[c] = normalized
    df = df.rename(columns=col_map)

    # Znajdź kolumny etapów (mogą mieć długie nazwy)
    stage_map = {}
    for c in df.columns:
        cu = c.upper()
        if 'ETAP 1' in cu or ('ETAP' in cu and 'CI' in cu):
            stage_map['ETAP 1'] = c
        elif 'ETAP 2.1' in cu or ('ETAP' in cu and 'SK' in cu and 'OKUW' in cu):
            stage_map['ETAP 2.1'] = c
        elif 'ETAP 2.2' in cu or ('ETAP' in cu and 'SZKL' in cu and 'DOSTAWK' in cu):
            stage_map['ETAP 2.2'] = c
        elif 'ETAP 3' in cu or ('ETAP' in cu and 'FREZOW' in cu and 'OTWOR' in cu):
            stage_map['ETAP 3'] = c
        elif 'ERAP 4' in cu or 'ETAP 4' in cu or ('ETAP' in cu and 'OKUW' in cu and 'SZKL' in cu and 'SKRZY' in cu):
            stage_map['ERAP 4'] = c
        elif 'ETAP 5' in cu or ('ETAP' in cu and 'PAKOW' in cu):
            stage_map['ETAP 5'] = c

    records = []
    skipped = 0
    for _, row in df.iterrows():
        r = row.to_dict()

        # Dodaj znormalizowane klucze etapów
        for stage_key, col_name in stage_map.items():
            r[stage_key] = r.get(col_name)

        nr = r.get('NR. ZLECENIA') or r.get('NR ZLECENIA')
        if nr is None or (isinstance(nr, float) and math.isnan(nr)):
            skipped += 1
            continue

        try:
            mapped = map_row(r, wykonawca)
            if not mapped['order_number']:
                skipped += 1
                continue
            records.append(mapped)
        except Exception as e:
            print(f'    WARN: błąd mapowania wiersza {nr}: {e}')
            skipped += 1

    print(f'    → {len(records)} rekordów, pominięto {skipped}')
    return records

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print('=' * 60)
    print('MIGRACJA: Zamówienia STA/Disting → Supabase')
    print('=' * 60)

    sheets = [
        ('Zamowienia Profil', 'Profil'),
        ('Zamowienia Center', 'Center'),
        ('Zamowienia WZ',     'WZ'),
    ]

    all_records: list[dict] = []
    for sheet_name, wykonawca in sheets:
        try:
            records = read_sheet(EXCEL_PATH, sheet_name, wykonawca)
            all_records.extend(records)
        except Exception as e:
            print(f'BŁĄD czytania arkusza {sheet_name}: {e}')

    print(f'\nŁącznie do migracji: {len(all_records)} rekordów')
    print(f'  STA: {sum(1 for r in all_records if r["category"] == "STA")}')
    print(f'  Disting: {sum(1 for r in all_records if r["category"] == "Disting")}')
    print(f'  Anulowane: {sum(1 for r in all_records if r.get("extra_fields", {}).get("cancelled"))}')
    print(f'  Wydane: {sum(1 for r in all_records if r.get("release_date"))}')

    print('\nRozpoczynam wstawianie...')
    total_ok = 0
    total_err = 0
    batches = [all_records[i:i+BATCH_SIZE] for i in range(0, len(all_records), BATCH_SIZE)]

    for i, batch in enumerate(batches, 1):
        ok, errors = insert_batch(batch)
        total_ok += ok
        if errors:
            total_err += len(batch)
            for e in errors:
                print(f'  Batch {i}/{len(batches)} BŁĄD: {e}')
        else:
            print(f'  Batch {i}/{len(batches)}: +{ok} ✓')

    print('\n' + '=' * 60)
    print(f'GOTOWE: {total_ok} wstawionych, {total_err} błędów')
    print('=' * 60)

    if total_err == 0:
        print('\nLinkowanie par DISTING PLUS...')
        link_disting_pairs()

def link_disting_pairs():
    """
    Łączy pary Disting ↔ STA przez linked_order_id.
    Disting order ma NR W ARKUSZU DISTING = numer porządkowy (np. 'PD 3087').
    Szukamy STA orders z tym samym disting_sheet.
    UWAGA: W tym pliku Disting i STA nie mają bezpośredniego linku przez NR ZLECENIA.
    Linkowanie pozostawiamy do ręcznej weryfikacji lub importu z pliku Disting.
    """
    print('Uwaga: automatyczne linkowanie Disting ↔ STA wymaga drugiego pliku.')
    print('Pary można połączyć ręcznie w aplikacji po weryfikacji.')

if __name__ == '__main__':
    main()
