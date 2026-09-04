import type {
  BastionOrderFormData,
  ComplaintFormData,
  ConfigDictionaryDef,
  OrderCategory,
  ContractorFormData,
  NewOrderFormData,
  MmFormState,
  PzFormState,
  RecipeFormState,
  RecipePart,
  StageDef,
  StaOrderFormData,
  StOrderFormData,
  TechniczneOrderFormData,
  UserFormState,
  WarehouseSubTab,
} from './types'

export const INITIAL_COMPLAINT_FORM_DATA: ComplaintFormData = {
  order_id: null,
  order_number: '',
  company: '',
  what_complained: '',
  reason: '',
  order_date: '',
  production_day: '',
  quantity: 0,
  sequence: '',
  system: '',
  model: '',
  wing_color: '',
  frame_color: '',
  threshold_color: '',
  width: '',
  direction: '',
  opening: '',
  height: '',
  glazing: '',
  decorative_panel: '',
  hardware: '',
  handle: '',
  electric_strike: '',
  peephole: '',
  top_light: '',
  top_light_glazing: '',
  side_panel: '',
  side_panel_glazing: '',
  extension: '',
  release_date: null,
  disting_sheet: '',
  sta_sheet: '',
  notes: '',
  client_order_number: '',
  defects: '',
  configurator_value: '',
  info: '',
  airtable_id: '',
  label: '',
  is_rush: false,
  linked_complaint_id: null,
}

export const TABS = [
  'Pulpit',
  'Moje stanowisko',
  'STA',
  'Disting',
  'ST',
  'Techniczne',
  'Bastion',
  'DrzwiWewnetrzne',
  'Statystyki',
  'Weryfikacja',
  'Audyt',
  'Archiwum',
  'Wysyłka',
  'Magazyn',
  'Zamawianie',
  'Inwentaryzacja',
  'Etykiety',
  'Kontrahenci',
  'Konfiguracja',
  'Użytkownicy',
  'Klucze API',
  'Zgłoszenia',
  'Pomoc',
] as const

export const EDITABLE_CATEGORIES = [
  'Bastion',
  'Disting',
  'STA',
  'ST',
  'Techniczne',
  'DrzwiWewnetrzne',
] as const

export type EditableCategory = typeof EDITABLE_CATEGORIES[number]

export const STATS_SUB_TABS = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne', 'Reklamacje', 'Produktywność', 'Czas realizacji'] as const

export const CATEGORY_LABELS: Record<OrderCategory, string> = {
  STA: 'STA',
  Disting: 'Disting',
  ST: 'ST',
  Techniczne: 'Techniczne',
  Bastion: 'Bastion',
  DrzwiWewnetrzne: 'Drzwi wewnętrzne',
}

export const DEPARTMENT_LABELS: Record<string, string> = {
  all: 'Wszystkie',
  bastion: 'Bastion',
  stalowe: 'Stalowe',
  magazyn: 'Magazyn',
}

export const WAREHOUSE_SUB_TABS: WarehouseSubTab[] = [
  'Komponenty',
  'Stany',
  'Rezerwacje',
  'W drodze',
  'Receptury',
  'Ruchy',
  'Przyjęcia',
  'Przesunięcia',
  'Miesięczne zużycie',
  'Prognozy',
  'Alerty',
  'Zamówienia',
  'Zamawianie',
  'Inwentaryzacja',
]

export const PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  raw: 'Surowiec',
  door_wing: 'Skrzydło wewnętrzne',
  door_frame: 'Ościeżnica wewnętrzna',
  door_handle: 'Klamka',
  door_hinge_cover: 'Osłonka na zawias',
}

export const PRODUCT_CATEGORY_FILTER_LABELS: Record<string, string> = {
  raw: 'Surowce',
  door_wing: 'Skrzydła wewnętrzne',
  door_frame: 'Ościeżnice wewnętrzne',
  door_handle: 'Klamki',
  door_hinge_cover: 'Osłonki na zawias',
}

export const INITIAL_PZ_FORM: PzFormState = {
  warehouse_id: null,
  reference_doc: '',
  notes: '',
  items: [],
}

export const INITIAL_MM_FORM: MmFormState = {
  warehouse_from_id: null,
  warehouse_to_id: null,
  reference_doc: '',
  notes: '',
  items: [],
}

export const RECIPE_PARTS: { value: RecipePart; label: string }[] = [
  { value: 'wing', label: 'Skrzydło' },
  { value: 'frame', label: 'Ościeżnica' },
  { value: 'hardware', label: 'Okucia bazowe' },
  { value: 'fittings', label: 'Okucia wykończeniowe' },
  { value: 'handle', label: 'Pochwyt' },
  { value: 'peephole', label: 'Wizjer' },
  { value: 'electric_strike', label: 'Elektrozaczep' },
  { value: 'glazing', label: 'Szklenie' },
  { value: 'decorative_panel', label: 'Panel dekoracyjny' },
  { value: 'other', label: 'Inne' },
]

// Katalog pól, po których receptura może dopasowywać (dynamiczne kryteria).
// dict = typ słownika z Konfiguracji (config_options.type); options = wartości stałe.
export const RECIPE_CRITERIA_FIELD_DEFS: Array<{
  key: string
  label: string
  dict?: string
  options?: string[]
}> = [
  { key: 'system', label: 'System', dict: 'system' },
  { key: 'model', label: 'Model', dict: 'model' },
  { key: 'wing_color', label: 'Kolor skrzydła', dict: 'kolor' },
  { key: 'frame_color', label: 'Kolor ościeżnicy', dict: 'kolor_oscieznicy' },
  { key: 'threshold_color', label: 'Kolor progu', dict: 'kolor_progu' },
  { key: 'width', label: 'Rozmiar (szerokość)', dict: 'rozmiar' },
  { key: 'height', label: 'Wysokość', dict: 'wysokosc' },
  { key: 'direction', label: 'Kierunek', options: ['PRAWE', 'LEWE'] },
  { key: 'opening', label: 'Otwieranie', options: ['ONZ', 'ONW'] },
  { key: 'glazing', label: 'Szklenie', dict: 'szklenie' },
  { key: 'top_light_glazing', label: 'Szklenie naświetla', dict: 'szklenie_dostawki' },
  { key: 'side_panel_a_glazing', label: 'Szklenie dostawki A', dict: 'szklenie_dostawki' },
  { key: 'side_panel_b_glazing', label: 'Szklenie dostawki B', dict: 'szklenie_dostawki' },
  { key: 'decorative_panel', label: 'Panel dekoracyjny', dict: 'panel' },
  { key: 'hardware', label: 'Okucia', dict: 'okucia' },
  { key: 'handle', label: 'Pochwyt', dict: 'pochwyt' },
  { key: 'peephole', label: 'Wizjer', dict: 'wizjer' },
  { key: 'electric_strike', label: 'Elektrozaczep', dict: 'zaczep' },
  { key: 'zaczep', label: 'Zaczep', dict: 'zaczep' },
  { key: 'oslonki', label: 'Osłonki', dict: 'oslonki' },
  { key: 'prog', label: 'Próg (rodzaj)', dict: 'prog' },
  { key: 'bastion_frame_type', label: 'Ościeżnica (Bastion)', dict: 'oscieznica' },
]

export const INITIAL_RECIPE_FORM: RecipeFormState = {
  name: '',
  category: 'STA',
  part: 'wing',
  criteria: [],
  system: '',
  model: '',
  wing_color: '',
  frame_color: '',
  width: '',
  glazing: '',
  direction: '',
  decorative_panel: '',
  hardware: '',
  handle: '',
  peephole: '',
  electric_strike: '',
  is_active: true,
  notes: '',
  components: [],
}

export const INITIAL_USER_FORM: UserFormState = {
  username: '',
  full_name: '',
  initials: '',
  password: '',
  role: 'pracownik_produkcji',
  department: 'all',
  categories: [],
}

export const CONFIG_FORM_CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'Wewnetrzne'] as const

export const CONFIG_DICTIONARIES: ConfigDictionaryDef[] = [
  { key: 'sta-system', label: 'Systemy', category: 'STA', type: 'system' },
  { key: 'sta-model', label: 'Modele', category: 'STA', type: 'model' },
  { key: 'sta-kolor', label: 'Kolory', category: 'STA', type: 'kolor' },
  { key: 'sta-kolor-progu', label: 'Kolory progu', category: 'STA', type: 'kolor_progu' },
  { key: 'sta-rozmiar', label: 'Rozmiary', category: 'STA', type: 'rozmiar' },
  { key: 'sta-wysokosc', label: 'Wysokości', category: 'STA', type: 'wysokosc' },
  { key: 'sta-szklenie', label: 'Szklenie', category: 'STA', type: 'szklenie' },
  {
    key: 'sta-szklenie-dostawki',
    label: 'Szklenie dostawek/naświetli',
    category: 'STA',
    type: 'szklenie_dostawki',
  },
  { key: 'sta-panel', label: 'Panele dekoracyjne', category: 'STA', type: 'panel' },
  { key: 'sta-wizjer', label: 'Wizjery', category: 'STA', type: 'wizjer' },
  { key: 'sta-okucia', label: 'Okucia', category: 'STA', type: 'okucia' },
  { key: 'sta-pochwyt', label: 'Pochwyty', category: 'STA', type: 'pochwyt' },
  { key: 'sta-oslonki', label: 'Osłonki', category: 'STA', type: 'oslonki' },
  { key: 'sta-zaczep', label: 'Zaczepy', category: 'STA', type: 'zaczep' },

  { key: 'disting-system', label: 'Systemy', category: 'Disting', type: 'system' },
  { key: 'disting-model', label: 'Modele', category: 'Disting', type: 'model' },
  { key: 'disting-kolor', label: 'Kolory', category: 'Disting', type: 'kolor' },
  { key: 'disting-kolor-progu', label: 'Kolory progu', category: 'Disting', type: 'kolor_progu' },
  { key: 'disting-rozmiar', label: 'Rozmiary', category: 'Disting', type: 'rozmiar' },
  { key: 'disting-wysokosc', label: 'Wysokości', category: 'Disting', type: 'wysokosc' },
  { key: 'disting-szklenie', label: 'Szklenie', category: 'Disting', type: 'szklenie' },
  {
    key: 'disting-szklenie-dostawki',
    label: 'Szklenie dostawek/naświetli',
    category: 'Disting',
    type: 'szklenie_dostawki',
  },
  { key: 'disting-panel', label: 'Panele dekoracyjne', category: 'Disting', type: 'panel' },
  { key: 'disting-wizjer', label: 'Wizjery', category: 'Disting', type: 'wizjer' },
  { key: 'disting-okucia', label: 'Okucia', category: 'Disting', type: 'okucia' },
  { key: 'disting-pochwyt', label: 'Pochwyty', category: 'Disting', type: 'pochwyt' },
  { key: 'disting-oslonki', label: 'Osłonki', category: 'Disting', type: 'oslonki' },
  { key: 'disting-zaczep', label: 'Zaczepy', category: 'Disting', type: 'zaczep' },

  { key: 'st-system', label: 'Systemy', category: 'ST', type: 'system' },
  { key: 'st-model', label: 'Modele', category: 'ST', type: 'model' },
  { key: 'st-kolor', label: 'Kolory', category: 'ST', type: 'kolor' },
  { key: 'st-kolor-progu', label: 'Kolory progu', category: 'ST', type: 'kolor_progu' },
  { key: 'st-rozmiar', label: 'Rozmiary', category: 'ST', type: 'rozmiar' },
  { key: 'st-wysokosc', label: 'Wysokości', category: 'ST', type: 'wysokosc' },
  { key: 'st-szklenie', label: 'Szklenie', category: 'ST', type: 'szklenie' },
  { key: 'st-wizjer', label: 'Wizjery', category: 'ST', type: 'wizjer' },
  { key: 'st-okucia', label: 'Okucia', category: 'ST', type: 'okucia' },
  { key: 'st-pochwyt', label: 'Pochwyty', category: 'ST', type: 'pochwyt' },
  { key: 'st-prog', label: 'Progi', category: 'ST', type: 'prog' },

  { key: 'tech-system', label: 'Systemy', category: 'Techniczne', type: 'system' },
  { key: 'tech-model', label: 'Modele', category: 'Techniczne', type: 'model' },
  { key: 'tech-kolor', label: 'Kolory', category: 'Techniczne', type: 'kolor' },
  { key: 'tech-kolor-progu', label: 'Kolory progu', category: 'Techniczne', type: 'kolor_progu' },
  { key: 'tech-rozmiar', label: 'Rozmiary', category: 'Techniczne', type: 'rozmiar' },
  { key: 'tech-wysokosc', label: 'Wysokości', category: 'Techniczne', type: 'wysokosc' },
  { key: 'tech-szklenie', label: 'Szklenie', category: 'Techniczne', type: 'szklenie' },
  { key: 'tech-wizjer', label: 'Wizjery', category: 'Techniczne', type: 'wizjer' },
  { key: 'tech-okucia', label: 'Okucia', category: 'Techniczne', type: 'okucia' },
  { key: 'tech-pochwyt', label: 'Pochwyty', category: 'Techniczne', type: 'pochwyt' },
  { key: 'tech-wentylacja', label: 'Wentylacja', category: 'Techniczne', type: 'wentylacja' },

  { key: 'bastion-system', label: 'Systemy', category: 'Bastion', type: 'system' },
  { key: 'bastion-model', label: 'Modele', category: 'Bastion', type: 'model' },
  { key: 'bastion-kolor', label: 'Kolory skrzydła', category: 'Bastion', type: 'kolor' },
  {
    key: 'bastion-kolor-oscieznicy',
    label: 'Kolory ościeżnicy',
    category: 'Bastion',
    type: 'kolor_oscieznicy',
  },
  { key: 'bastion-kolor_progu', label: 'Kolory progu', category: 'Bastion', type: 'kolor_progu' },
  { key: 'bastion-rozmiar', label: 'Rozmiary', category: 'Bastion', type: 'rozmiar' },
  { key: 'bastion-wysokosc', label: 'Wysokości', category: 'Bastion', type: 'wysokosc' },
  { key: 'bastion-szklenie', label: 'Lacobel/Szklenie', category: 'Bastion', type: 'szklenie' },
  { key: 'bastion-wizjer', label: 'Wizjery', category: 'Bastion', type: 'wizjer' },
  { key: 'bastion-okucia', label: 'Okucia', category: 'Bastion', type: 'okucia' },
  { key: 'bastion-oscieznica', label: 'Ościeżnice/Zabudowy', category: 'Bastion', type: 'oscieznica' },
  { key: 'bastion-zakres', label: 'Zakresy ościeżnicy', category: 'Bastion', type: 'zakres' },
  { key: 'bastion-kolekcja', label: 'Kolekcje', category: 'Bastion', type: 'kolekcja' },
  { key: 'wewnetrzne-model', label: 'Modele skrzydeł', category: 'Wewnetrzne', type: 'model' },
  { key: 'wewnetrzne-kolor', label: 'Kolory', category: 'Wewnetrzne', type: 'kolor' },
  { key: 'wewnetrzne-rozmiar', label: 'Rozmiary', category: 'Wewnetrzne', type: 'rozmiar' },
  { key: 'wewnetrzne-szyld', label: 'Szyldy klamek', category: 'Wewnetrzne', type: 'szyld' },
  { key: 'wewnetrzne-model-klamki', label: 'Modele klamek', category: 'Wewnetrzne', type: 'model_klamki' },
  { key: 'wewnetrzne-wentylacja', label: 'Wentylacja', category: 'Wewnetrzne', type: 'wentylacja' },
  { key: 'wewnetrzne-kolor-klamki', label: 'Kolory klamek', category: 'Wewnetrzne', type: 'kolor_klamki' },
  { key: 'wewnetrzne-kolor-oslonki', label: 'Kolory osłonek', category: 'Wewnetrzne', type: 'kolor_oslonki' },
  {
    key: 'wewnetrzne-frame-code',
    label: 'Typy ościeżnic regulowanych',
    category: 'Wewnetrzne',
    type: 'frame_code',
  },
]

export const EXCLUSION_FIELD_TO_OPTION_TYPE: Record<string, string> = {
  system: 'system',
  model: 'model',
  wing_color: 'kolor',
  frame_color: 'kolor',
  threshold_color: 'kolor_progu',
  width: 'rozmiar',
  height: 'wysokosc',
  glazing: 'szklenie',
  decorative_panel: 'panel',
  peephole: 'wizjer',
  hardware: 'okucia',
  handle: 'pochwyt',
  electric_strike: 'zaczep',
}

export const EXCLUSION_FIELD_LABELS: Record<string, string> = {
  system: 'System',
  model: 'Model',
  wing_color: 'Kolor skrzydła',
  frame_color: 'Kolor ościeżnicy',
  threshold_color: 'Kolor progu',
  width: 'Szerokość',
  height: 'Wysokość',
  glazing: 'Szklenie',
  decorative_panel: 'Panel dekoracyjny',
  peephole: 'Wizjer',
  hardware: 'Okucia',
  handle: 'Pochwyt',
  electric_strike: 'Zaczep',
}

export const PRODUCTION_DAYS = ['PONIEDZIAŁEK', 'WTOREK', 'ŚRODA', 'CZWARTEK', 'PIĄTEK'] as const

export const STA_DISTING_STAGE_DEFS: StageDef[] = [
  { key: 'e1', header: 'E1', title: 'ETAP 1 - cięcie i frezowanie ościeżnicy' },
  { key: 'e2_1', header: 'E2.1', title: 'ETAP 2.1 - składanie i okuwanie ościeżnicy' },
  { key: 'e2_2', header: 'E2.2', title: 'ETAP 2.2 - składanie i szklenie dostawki/naświetla' },
  { key: 'e3', header: 'E3', title: 'ETAP 3 - frezowanie otworów w skrzydle' },
  { key: 'e4', header: 'E4', title: 'ETAP 4 - okuwanie i szklenie skrzydła' },
  { key: 'e5', header: 'E5', title: 'ETAP 5 - pakowanie' },
]

export const WHAT_COMPLAINED_OPTIONS = [
  'Skrzydło',
  'Ościeżnica',
  'Komplet',
] as const

export const ST_STAGE_DEFS: StageDef[] = [
  { key: 'cnc', header: 'CNC', title: 'CNC' },
  { key: 'osc', header: 'OŚC', title: 'Ościeżnica' },
  { key: 'skr', header: 'SKR', title: 'Skrzydło' },
  { key: 'mon', header: 'MON', title: 'Montaż' },
  { key: 'mag', header: 'MAG', title: 'Magazyn' },
]

export const ST_TITAN_STAGE_DEFS: StageDef[] = [
  { key: 'e1', header: 'E1', title: 'E1 — ościeżnica (jedyny etap ST dla Titana)' },
  { key: 'e2', header: 'E2', title: 'E2 — skrzydło (robione w STA) — nieaktywne w ST' },
  { key: 'e3', header: 'E3', title: 'E3 — okuwanie (Bastion) — nieaktywne w ST' },
  { key: 'e4', header: 'E4', title: 'E4 — montaż/pakowanie (Bastion) — nieaktywne w ST' },
]

export const ST_MIXED_STAGE_DEFS: StageDef[] = [
  { key: 'st_mix_0', header: 'CNC', title: 'CNC (ST) — dla Titana nieaktywne' },
  { key: 'st_mix_1', header: 'OŚC', title: 'OŚC (ST) lub ościeżnica E1 (Titan)' },
  { key: 'st_mix_2', header: 'SKR', title: 'SKR (ST) — dla Titana nieaktywne (skrzydło robi STA)' },
  { key: 'st_mix_3', header: 'MON', title: 'MON (ST) — dla Titana nieaktywne (montaż na Bastionie)' },
  { key: 'st_mix_4', header: 'MAG', title: 'Magazyn (ST) — dla Titana nieaktywne' },
]

export const BASTION_STAGE_DEFS: StageDef[] = [
  { key: 'cnc', header: 'CNC', title: 'CNC' },
  { key: 'okleinowanie_skrzydla', header: 'OKL. SKR.', title: 'OKLEINOWANIE SKRZYDŁA' },
  { key: 'okuwanie_skrzydla', header: 'OKU. SKR.', title: 'OKUWANIE SKRZYDŁA' },
  { key: 'oscieznica_cnc', header: 'OŚĆ CNC', title: 'OŚCIEŻNICA CNC (FREZOWANIE)' },
  {
    key: 'oscieznica_skrecanie',
    header: 'OŚĆ SKR.',
    title: 'OŚCIEŻNICA (SKRĘCANIE I OKUWANIE)',
  },
  { key: 'magazyn_kontrola', header: 'MAG. KTR.', title: 'MAGAZYN, KONTROLA ODBIORCZA' },
  { key: 'stolarnia', header: 'STOL.', title: 'STOLARNIA (ZABUDOWY, PROGI, OPASKI ITP.)' },
  { key: 'magazyn_regulowana', header: 'MAG. REG.', title: 'MAGAZYN REGULOWANE' },
  {
    key: 'regulowana_do_zlozenia',
    header: 'REG. DO ZŁ.',
    title: 'REGULOWANA DO ZŁOŻENIA',
  },
]

// Titan w Bastionie: skrzydło (ze STA) okuwane, montowane z ościeżnicą (z ST), pakowane.
export const BASTION_TITAN_STAGE_DEFS: StageDef[] = [
  { key: 'tit_oku', header: 'OKU', title: 'Okuwanie skrzydła (Titan)' },
  { key: 'tit_mon', header: 'MONT', title: 'Montaż drzwi (skrzydło + ościeżnica)' },
  { key: 'tit_pak', header: 'PAK', title: 'Pakowanie' },
]

export const STA_DISTING_PLUS_MIRROR_KEYS = ['dist_e1', 'dist_e2_1', 'dist_e2_2', 'dist_e5'] as const
export const DISTING_PLUS_MIRROR_KEYS = ['sta_e3', 'sta_e4'] as const

export const INITIAL_FORM_DATA: NewOrderFormData = {
  order_number: '',
  category: 'STA',
  company: '',
  order_date: '',
  production_day: 'PONIEDZIAŁEK',
  quantity: 1,
  sequence: '',
  system: 'NORMAL',
  model: '',
  wing_color: '',
  frame_color: '',
  threshold_color: '',
  width: '',
  direction: '',
  opening: '',
  height: '',
  glazing: '',
  hardware: '',
  notes: '',
  entered_by: '',
}

export const INITIAL_CONTRACTOR_FORM: ContractorFormData = {
  name: '',
  city: '',
  route_day: 'PONIEDZIAŁEK',
  production_day: 'PONIEDZIAŁEK',
}

export const INITIAL_STA_ORDER_FORM: StaOrderFormData = {
  order_number: '',
  category: 'STA',
  company: '',
  production_day: 'PONIEDZIAŁEK',
  system: '',
  model: '',
  wing_color: '',
  frame_color: '',
  threshold_color: '',
  width: '',
  direction: '',
  height: '',
  opening: '',
  glazing: '',
  decorative_panel: '',
  top_light_w_mm: '',
  top_light_h_mm: '',
  top_light_glazing: '',
  side_panel_a_w_mm: '',
  side_panel_b_w_mm: '',
  side_panel_h_mm: '',
  side_panel_a_glazing: '',
  side_panel_b_glazing: '',
  extension: '',
  extension_qtys: { a: {}, b: {}, top: {} },
  peephole: '',
  hardware: '',
  handle: '',
  oslonki: '',
  zaczep: '',
  stage1: '',
  stage2_1: '',
  stage2_2: '',
  stage3: '',
  stage4: '',
  stage5: '',
  quantity: 1,
  notes: '',
  client_order_number: '',
  wykonawca: '',
}

export const INITIAL_ST_ORDER_FORM: StOrderFormData = {
  order_number: '',
  category: 'ST',
  company: '',
  production_day: 'PONIEDZIAŁEK',
  system: '',
  model: '',
  wing_color: '',
  threshold_color: '',
  width: '',
  direction: '',
  height: '',
  opening: '',
  glazing: '',
  peephole: '',
  hardware: '',
  extension: '',
  handle: '',
  quantity: 1,
  notes: '',
  client_order_number: '',
  sta_ref: '',
}

export const INITIAL_TECHNICZNE_ORDER_FORM: TechniczneOrderFormData = {
  order_number: '',
  category: 'Techniczne',
  company: '',
  production_day: 'PONIEDZIAŁEK',
  system: '',
  model: '',
  wing_color: '',
  threshold_color: '',
  width: '',
  direction: '',
  height: '',
  opening: '',
  glazing: '',
  peephole: '',
  hardware: '',
  handle: '',
  wentylacja: '',
  quantity: 1,
  notes: '',
  client_order_number: '',
}

export const INITIAL_BASTION_ORDER_FORM: BastionOrderFormData = {
  order_number: '',
  category: 'Bastion',
  company: '',
  production_day: 'PONIEDZIAŁEK',
  system: '',
  model: '',
  wing_color: '',
  frame_color: '',
  threshold_color: '',
  width: '',
  direction: '',
  height: '',
  opening: '',
  glazing: '',
  peephole: '',
  hardware: '',
  quantity: 1,
  notes: '',
  notes_2: '',
  client_order_number: '',
  collection: '',
  frame_type: '',
  frame_range: '',
  side_panel_k_w: '',
  side_panel_p_w: '',
  side_panel_h: '',
  top_panel_w: '',
  top_panel_h: '',
  sales_changes: '',
  rush_date: '',
  day_of_week: '',
  is_promo: false,
  is_production_rush: false,
  production_priority: '',
  label_qty: 0,
}

export const PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Szkic',
  sent: 'Wysłane',
  partial: 'Częściowe',
  completed: 'Zakończone',
  cancelled: 'Anulowane',
}

export const PURCHASE_ORDER_ITEM_STATUS_LABELS: Record<string, string> = {
  pending: 'Oczekuje',
  partial: 'Częściowa',
  completed: 'Zrealizowana',
  cancelled: 'Anulowana',
}
