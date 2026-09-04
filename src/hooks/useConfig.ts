import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import { CONFIG_DICTIONARIES } from '../constants'
import type {
  ConfigExclusion,
  ConfigFormCategory,
  ConfigOptionRecord,
  ConfigSubTab,
  DeleteConfirmState,
  DimensionMap,
  ExtensionProfileWidth,
  GlassAllowance,
  LeadTimeRule,
  ToastVariant,
} from '../types'

type UseConfigParams = {
  pushToast: (message: string, variant: ToastVariant) => void
  setGlobalLoading: (v: boolean) => void
  setDeleteConfirm: (v: DeleteConfirmState | null) => void
}

export function useConfig({
  pushToast,
  setGlobalLoading,
  setDeleteConfirm,
}: UseConfigParams) {
  // ── Sub-tab & category ──────────────────────────────────────────────────────
  const [activeConfigSubTab, setActiveConfigSubTab] = useState<ConfigSubTab>('Słowniki')
  const [selectedConfigCategory, setSelectedConfigCategory] = useState<ConfigFormCategory>('STA')
  const [selectedConfigDictKey, setSelectedConfigDictKey] = useState<string>('sta-system')

  // ── Config options list (słowniki) ──────────────────────────────────────────
  const [configOptionsList, setConfigOptionsList] = useState<ConfigOptionRecord[]>([])
  const [internalDoorConfigOptions, setInternalDoorConfigOptions] = useState<ConfigOptionRecord[]>([])
  const [allConfigDefaults, setAllConfigDefaults] = useState<ConfigOptionRecord[]>([])
  const [bastionFrameOptions, setBastionFrameOptions] = useState<ConfigOptionRecord[]>([])
  const [configOptions, setConfigOptions] = useState<Record<string, Record<string, string[]>>>({})
  const [configOptionsLoading, setConfigOptionsLoading] = useState(false)

  // ── Config option modal ─────────────────────────────────────────────────────
  const [isConfigOptionModalOpen, setIsConfigOptionModalOpen] = useState(false)
  const [isConfigOptionSaving, setIsConfigOptionSaving] = useState(false)
  const [editingConfigOption, setEditingConfigOption] = useState<ConfigOptionRecord | null>(null)
  const [configOptionForm, setConfigOptionForm] = useState({ value: '', sort_order: 0 })
  const [configAddStep, setConfigAddStep] = useState<'value' | 'dimensions'>('value')
  const [pendingRozmiarValue, setPendingRozmiarValue] = useState('')

  // ── Drag & drop reorder ─────────────────────────────────────────────────────
  const [draggedItemId, setDraggedItemId] = useState<number | string | null>(null)
  const [dragOverItemId, setDragOverItemId] = useState<number | string | null>(null)

  // ── Exclusions (wykluczenia) ────────────────────────────────────────────────
  const [exclusions, setExclusions] = useState<ConfigExclusion[]>([])
  const [exclusionForm, setExclusionForm] = useState({
    category: 'STA',
    source_field: '',
    source_values: [] as string[],
    target_field: '',
    target_value: '',
  })
  const [exclusionSourceFilter, setExclusionSourceFilter] = useState('')
  const [activeExclusionCategory, setActiveExclusionCategory] = useState('STA')
  const [exclusionSearch, setExclusionSearch] = useState('')

  // ── Dimension map (słownik wymiarów) ────────────────────────────────────────
  const [dimensionMap, setDimensionMap] = useState<DimensionMap[]>([])
  const [dimensionMapForm, setDimensionMapForm] = useState({
    category: 'STA',
    dimension_code: '',
    width_mm: 0,
    height_mm: 0,
  })
  const [dimensionModalForm, setDimensionModalForm] = useState({ width_mm: 0, height_mm: 0 })

  // ── Glass allowances (naddatki szyb) ────────────────────────────────────────
  const [glassAllowances, setGlassAllowances] = useState<GlassAllowance[]>([])

  // ── Lead time rules ─────────────────────────────────────────────────────────
  const [leadTimeRules, setLeadTimeRules] = useState<LeadTimeRule[]>([])

  // ── Extension profile widths ────────────────────────────────────────────────
  const [extensionProfileForm, setExtensionProfileForm] = useState({
    category: 'STA',
    profile_width_mm: 0,
  })
  const [extensionProfileWidths, setExtensionProfileWidths] = useState<
    { category: string; profile_width_mm: number }[]
  >([])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const selectedConfigDict =
    CONFIG_DICTIONARIES.find(
      (d) => d.key === selectedConfigDictKey && d.category === selectedConfigCategory,
    ) ??
    CONFIG_DICTIONARIES.filter((d) => d.category === selectedConfigCategory)[0] ??
    CONFIG_DICTIONARIES[0]

  const selectedConfigDictType = selectedConfigDict.type

  // ── Fetch functions ─────────────────────────────────────────────────────────
  const fetchExclusions = useCallback(async () => {
    // Paginacja — PostgREST tnie po 1000 wierszy; wykluczeń jest już więcej
    // (bez tego nowe wpisy zapisywały się, ale znikały z listy i dedupu).
    const all: ConfigExclusion[] = []
    let from = 0
    const PAGE = 1000
    while (true) {
      const { data, error } = await supabase
        .from('config_exclusions')
        .select('*')
        .order('category', { ascending: true })
        .order('source_field', { ascending: true })
        .order('source_value', { ascending: true })
        .order('target_value', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) {
        console.error('fetchExclusions:', error)
        break
      }
      if (!data || data.length === 0) break
      all.push(...(data as ConfigExclusion[]))
      if (data.length < PAGE) break
      from += PAGE
    }
    setExclusions(all)
  }, [])

  const fetchDimensionMap = useCallback(async () => {
    const { data } = await supabase
      .from('dimension_map')
      .select('*')
      .order('category')
      .order('dimension_code')
    setDimensionMap((data || []) as DimensionMap[])
  }, [])

  const fetchExtensionProfileWidths = useCallback(async () => {
    const { data } = await supabase.from('extension_profile_width_map').select('*')
    setExtensionProfileWidths((data || []) as ExtensionProfileWidth[])
  }, [])

  const fetchGlassAllowances = useCallback(async () => {
    const { data } = await supabase
      .from('glass_allowances')
      .select('*')
      .order('category')
      .order('element')
    setGlassAllowances((data || []) as GlassAllowance[])
  }, [])

  const fetchAllConfigDefaults = useCallback(async () => {
    const { data, error } = await supabase
      .from('config_options')
      .select('*')
      .eq('is_default', true)
    if (error) {
      console.error(error)
      return
    }
    setAllConfigDefaults((data || []) as ConfigOptionRecord[])
  }, [])

  const fetchBastionFrameOptions = useCallback(async () => {
    const { data } = await supabase
      .from('config_options')
      .select('*')
      .eq('category', 'Bastion')
      .eq('type', 'oscieznica')
    const rows: ConfigOptionRecord[] = (data || []).map((row) => ({
      id: row.id as number | string,
      category: String(row.category ?? ''),
      type: String(row.type ?? ''),
      value: String(row.value ?? ''),
      sort_order: Number(row.sort_order ?? 0),
      is_default: Boolean(row.is_default),
      label_multiplier:
        row.label_multiplier === null || row.label_multiplier === undefined
          ? null
          : Number(row.label_multiplier),
      add_to_batch: Boolean(row.add_to_batch),
    }))
    setBastionFrameOptions(rows)
  }, [])

  const fetchConfigOptionsList = useCallback(async () => {
    const dict =
      CONFIG_DICTIONARIES.find(
        (d) => d.key === selectedConfigDictKey && d.category === selectedConfigCategory,
      ) ?? CONFIG_DICTIONARIES.find((d) => d.category === selectedConfigCategory)
    if (!dict) return
    setConfigOptionsLoading(true)
    const { data, error } = await supabase
      .from('config_options')
      .select('*')
      .eq('category', dict.category)
      .eq('type', dict.type)
      .order('sort_order', { ascending: true })
      .order('value', { ascending: true })
    if (error) {
      console.error(error)
      pushToast(`Wystąpił błąd: ${error.message}`, 'error')
      setConfigOptionsList([])
    } else {
      const rows: ConfigOptionRecord[] = (data || []).map((row) => ({
        id: row.id as number | string,
        category: String(row.category ?? ''),
        type: String(row.type ?? ''),
        value: String(row.value ?? ''),
        sort_order: Number(row.sort_order ?? 0),
        is_default: Boolean(row.is_default),
        label_multiplier:
          row.label_multiplier === null || row.label_multiplier === undefined
            ? null
            : Number(row.label_multiplier),
        add_to_batch: Boolean(row.add_to_batch),
      }))
      setConfigOptionsList(rows)
    }
    setConfigOptionsLoading(false)
  }, [selectedConfigDictKey, selectedConfigCategory, pushToast])

  const fetchInternalDoorConfigOptions = useCallback(async () => {
    const { data, error } = await supabase
      .from('config_options')
      .select('*')
      .eq('category', 'Wewnetrzne')
      .order('type', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('value', { ascending: true })
    if (error) {
      console.error(error)
      setInternalDoorConfigOptions([])
      return
    }
    const rows: ConfigOptionRecord[] = (data || []).map((row) => ({
      id: row.id as number | string,
      category: String(row.category ?? ''),
      type: String(row.type ?? ''),
      value: String(row.value ?? ''),
      sort_order: Number(row.sort_order ?? 0),
      is_default: Boolean(row.is_default),
      label_multiplier:
        row.label_multiplier === null || row.label_multiplier === undefined
          ? null
          : Number(row.label_multiplier),
      add_to_batch: Boolean(row.add_to_batch),
    }))
    setInternalDoorConfigOptions(rows)
  }, [])

  const fetchLeadTimeRules = useCallback(async () => {
    const { data, error } = await supabase
      .from('order_lead_time_rules')
      .select('*')
      .order('priority', { ascending: false })
      .order('id', { ascending: true })
    if (error) {
      console.error('[LeadTimeRules] fetch error:', error.message, error)
      pushToast(`Błąd ładowania reguł terminów: ${error.message}`, 'error')
      return
    }
    console.log('[LeadTimeRules] loaded:', data?.length, 'rows')
    setLeadTimeRules((data ?? []) as LeadTimeRule[])
  }, [pushToast])

  const handleSaveLeadTimeRule = useCallback(
    async (payload: Omit<LeadTimeRule, 'id'> & { id?: number }) => {
      setGlobalLoading(true)
      try {
        let error
        if (payload.id) {
          const { id, ...rest } = payload
          ;({ error } = await supabase
            .from('order_lead_time_rules')
            .update(rest)
            .eq('id', id))
        } else {
          const { id: _id, ...rest } = payload
          ;({ error } = await supabase.from('order_lead_time_rules').insert(rest))
        }
        if (error) {
          pushToast(`Błąd zapisu: ${error.message}`, 'error')
          return
        }
        pushToast(payload.id ? 'Reguła zaktualizowana' : 'Reguła dodana', 'success')
        await fetchLeadTimeRules()
      } finally {
        setGlobalLoading(false)
      }
    },
    [pushToast, setGlobalLoading, fetchLeadTimeRules],
  )

  const handleDeleteLeadTimeRule = useCallback(
    async (id: number) => {
      setGlobalLoading(true)
      try {
        const { error } = await supabase
          .from('order_lead_time_rules')
          .delete()
          .eq('id', id)
        if (error) {
          pushToast(`Błąd usuwania: ${error.message}`, 'error')
          return
        }
        pushToast('Reguła usunięta', 'success')
        await fetchLeadTimeRules()
      } finally {
        setGlobalLoading(false)
      }
    },
    [pushToast, setGlobalLoading, fetchLeadTimeRules],
  )

  const handleToggleLeadTimeRuleActive = useCallback(
    async (id: number, isActive: boolean) => {
      const { error } = await supabase
        .from('order_lead_time_rules')
        .update({ is_active: isActive })
        .eq('id', id)
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      setLeadTimeRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_active: isActive } : r)),
      )
    },
    [pushToast],
  )

  const fetchConfigOptionsForExclusions = useCallback(async () => {
    // Paginacja — pełny słownik wszystkich kategorii może przebić limit 1000 PostgREST
    const rows: Array<Record<string, unknown>> = []
    let from = 0
    const PAGE = 1000
    while (true) {
      const { data, error } = await supabase
        .from('config_options')
        .select('category, type, value, sort_order, id')
        .order('category', { ascending: true })
        .order('type', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('value', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) { console.error('fetchConfigOptionsForExclusions:', error); break }
      if (!data || data.length === 0) break
      rows.push(...(data as Array<Record<string, unknown>>))
      if (data.length < PAGE) break
      from += PAGE
    }
    const grouped: Record<string, Record<string, string[]>> = {}
    for (const row of rows) {
      const category = String((row as { category?: string }).category ?? '')
      const type = String((row as { type?: string }).type ?? '')
      const value = String((row as { value?: string }).value ?? '')
      if (!grouped[category]) grouped[category] = {}
      if (!grouped[category][type]) grouped[category][type] = []
      grouped[category][type].push(value)
    }
    setConfigOptions(grouped)
  }, [])

  // ── Config options CRUD ─────────────────────────────────────────────────────
  const reorderConfigOptionsSortOrder = useCallback(
    async (category: string, type: string): Promise<boolean> => {
      const { data, error } = await supabase
        .from('config_options')
        .select('id, sort_order, value')
        .eq('category', category)
        .eq('type', type)
      if (error) {
        console.error(error)
        return false
      }
      const remaining = [...(data || [])].sort((a, b) => {
        const byOrder = Number(a.sort_order) - Number(b.sort_order)
        if (byOrder !== 0) return byOrder
        return String(a.value ?? '').localeCompare(String(b.value ?? ''))
      })
      for (let i = 0; i < remaining.length; i++) {
        const newOrder = i + 1
        const id = remaining[i].id
        if (Number(remaining[i].sort_order) === newOrder) continue
        const { error: updateError } = await supabase
          .from('config_options')
          .update({ sort_order: newOrder })
          .eq('id', id)
        if (updateError) {
          console.error(updateError)
          return false
        }
      }
      return true
    },
    [],
  )

  // Ustawia pozycję na zadanym miejscu i renumeruje CAŁY słownik 1..n —
  // wpisanie "3" w edycji przesuwa pozostałe, zamiast zostawiać duplikat numeru
  // (zgłoszenie Dawida: dwie pozycje z tym samym numerem po edycji).
  const placeConfigOptionAt = useCallback(
    async (
      category: string,
      type: string,
      optionId: number | string,
      desiredOrder: number,
    ): Promise<boolean> => {
      const { data, error } = await supabase
        .from('config_options')
        .select('id, sort_order, value')
        .eq('category', category)
        .eq('type', type)
      if (error) {
        console.error(error)
        return false
      }
      const rows = [...(data || [])].sort((a, b) => {
        const byOrder = Number(a.sort_order) - Number(b.sort_order)
        if (byOrder !== 0) return byOrder
        return String(a.value ?? '').localeCompare(String(b.value ?? ''))
      })
      const idx = rows.findIndex((r) => r.id === optionId)
      if (idx === -1) return false
      const [moved] = rows.splice(idx, 1)
      const target = Math.min(Math.max(1, Math.round(desiredOrder) || 1), rows.length + 1)
      rows.splice(target - 1, 0, moved)
      for (let i = 0; i < rows.length; i++) {
        if (Number(rows[i].sort_order) === i + 1) continue
        const { error: updateError } = await supabase
          .from('config_options')
          .update({ sort_order: i + 1 })
          .eq('id', rows[i].id)
        if (updateError) {
          console.error(updateError)
          return false
        }
      }
      return true
    },
    [],
  )

  const handleReorderConfigOptions = async (reorderedItems: ConfigOptionRecord[]) => {
    setGlobalLoading(true)
    try {
      // 1-based — spójnie z renumeracją po usunięciu/edycji (wcześniej 0-based,
      // co po przeplocie z tamtymi ścieżkami potrafiło zostawić duplikaty)
      const updates = reorderedItems.map((item, index) => ({ id: item.id, sort_order: index + 1 }))
      await Promise.all(
        updates.map((update) =>
          supabase
            .from('config_options')
            .update({ sort_order: update.sort_order })
            .eq('id', update.id),
        ),
      )
      await fetchConfigOptionsList()
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleToggleConfigOptionDefault = async (
    option: ConfigOptionRecord,
    checked: boolean,
  ) => {
    setGlobalLoading(true)
    try {
      if (checked) {
        await supabase
          .from('config_options')
          .update({ is_default: false })
          .eq('category', option.category)
          .eq('type', option.type)
      }
      const { error } = await supabase
        .from('config_options')
        .update({ is_default: checked })
        .eq('id', option.id)
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      await fetchConfigOptionsList()
      await fetchAllConfigDefaults()
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleUpdateLabelMultiplier = async (
    row: ConfigOptionRecord,
    value: number | null,
  ) => {
    const { error } = await supabase
      .from('config_options')
      .update({ label_multiplier: value })
      .eq('id', row.id)
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    await fetchConfigOptionsList()
    await fetchAllConfigDefaults()
    await fetchBastionFrameOptions()
  }

  const handleUpdateAddToBatch = async (row: ConfigOptionRecord, checked: boolean) => {
    const { error } = await supabase
      .from('config_options')
      .update({ add_to_batch: checked })
      .eq('id', row.id)
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    await fetchConfigOptionsList()
    await fetchBastionFrameOptions()
  }

  const handleSaveConfigOption = async () => {
    const dict = selectedConfigDict
    const valueTrim = configOptionForm.value.trim()
    if (!valueTrim) {
      pushToast('Wystąpił błąd: podaj wartość', 'error')
      return
    }
    if (dict.type === 'rozmiar') {
      // Rozmiar zawsze przechodzi przez krok wymiarów — także przy EDYCJI
      // (wcześniej edycja pozwalała zmienić tylko nazwę; zgłoszenie z firmy).
      setPendingRozmiarValue(valueTrim)
      setConfigAddStep('dimensions')
      if (editingConfigOption !== null) {
        const existing = dimensionMap.find(
          (d) => d.category === dict.category && d.dimension_code === editingConfigOption.value,
        )
        setDimensionModalForm({
          width_mm: existing?.width_mm ?? 0,
          height_mm: existing?.height_mm ?? 0,
        })
      } else {
        setDimensionModalForm({ width_mm: 0, height_mm: 0 })
      }
      return
    }
    setIsConfigOptionSaving(true)
    setGlobalLoading(true)
    try {
      if (editingConfigOption === null) {
        const { data: inserted, error } = await supabase
          .from('config_options')
          .insert({
            category: dict.category,
            type: dict.type,
            value: valueTrim,
            sort_order: configOptionForm.sort_order,
          })
          .select('id')
          .single()
        if (error) {
          pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        } else {
          if (inserted) {
            await placeConfigOptionAt(dict.category, dict.type, (inserted as { id: number }).id, configOptionForm.sort_order)
          }
          pushToast('Wartość została dodana', 'success')
          setConfigAddStep('value')
          setPendingRozmiarValue('')
          setIsConfigOptionModalOpen(false)
          await fetchConfigOptionsList()
          await fetchInternalDoorConfigOptions()
        }
      } else {
        const { error } = await supabase
          .from('config_options')
          .update({ value: valueTrim, sort_order: configOptionForm.sort_order })
          .eq('id', editingConfigOption.id)
        if (error) {
          pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        } else {
          await placeConfigOptionAt(dict.category, dict.type, editingConfigOption.id, configOptionForm.sort_order)
          pushToast('Wartość została zaktualizowana', 'success')
          setConfigAddStep('value')
          setPendingRozmiarValue('')
          setIsConfigOptionModalOpen(false)
          await fetchConfigOptionsList()
          await fetchInternalDoorConfigOptions()
        }
      }
    } finally {
      setIsConfigOptionSaving(false)
      setGlobalLoading(false)
    }
  }

  const handleDeleteConfigOption = (row: ConfigOptionRecord) => {
    setDeleteConfirm({
      message: `Czy na pewno chcesz usunąć wartość „${row.value}"?`,
      runDelete: async () => {
        setGlobalLoading(true)
        try {
          const { error } = await supabase.from('config_options').delete().eq('id', row.id)
          if (error) {
            pushToast(`Wystąpił błąd: ${error.message}`, 'error')
            return
          }
          const renumbered = await reorderConfigOptionsSortOrder(row.category, row.type)
          pushToast(
            renumbered
              ? 'Wartość została usunięta'
              : 'Wartość usunięta, ale renumeracja kolejności nie powiodła się.',
            renumbered ? 'success' : 'error',
          )
          await fetchConfigOptionsList()
        } finally {
          setGlobalLoading(false)
        }
      },
    })
  }

  // ── Exclusions CRUD ─────────────────────────────────────────────────────────
  const handleSaveExclusion = async () => {
    if (
      !exclusionForm.source_field ||
      exclusionForm.source_values.length === 0 ||
      !exclusionForm.target_field ||
      !exclusionForm.target_value
    ) {
      return
    }
    const isDuplicate = exclusionForm.source_values.some((val) =>
      exclusions.some(
        (ex) =>
          ex.category === exclusionForm.category &&
          ex.source_field === exclusionForm.source_field &&
          ex.source_value === val &&
          ex.target_field === exclusionForm.target_field &&
          ex.target_value === exclusionForm.target_value,
      ),
    )
    if (isDuplicate && exclusionForm.source_values.length === 1) {
      pushToast('To wykluczenie już istnieje', 'error')
      return
    }
    setGlobalLoading(true)
    try {
      const toInsert = exclusionForm.source_values
        .filter(
          (val) =>
            !exclusions.some(
              (ex) =>
                ex.category === exclusionForm.category &&
                ex.source_field === exclusionForm.source_field &&
                ex.source_value === val &&
                ex.target_field === exclusionForm.target_field &&
                ex.target_value === exclusionForm.target_value,
            ),
        )
        .map((val) => ({
          category: exclusionForm.category,
          source_field: exclusionForm.source_field,
          source_value: val,
          target_field: exclusionForm.target_field,
          target_value: exclusionForm.target_value,
        }))

      if (toInsert.length === 0) {
        pushToast('Wszystkie wybrane wykluczenia już istnieją', 'error')
        return
      }

      const { error } = await supabase.from('config_exclusions').insert(toInsert)
      if (error) {
        pushToast(`Błąd zapisu: ${error.message}`, 'error')
        return
      }
      pushToast(`Dodano ${toInsert.length} wykluczeń`, 'success')
      setExclusionForm({
        category: exclusionForm.category,
        source_field: '',
        source_values: [],
        target_field: '',
        target_value: '',
      })
      setExclusionSourceFilter('')
      void fetchExclusions()
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleDeleteExclusion = async (id: number) => {
    setGlobalLoading(true)
    try {
      const { error } = await supabase.from('config_exclusions').delete().eq('id', id)
      if (error) {
        pushToast(`Błąd usuwania: ${error.message}`, 'error')
        return
      }
      void fetchExclusions()
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleDeleteExclusionGroup = async (
    category: string,
    sourceField: string,
    sourceValue: string,
  ) => {
    setGlobalLoading(true)
    try {
      const { error } = await supabase
        .from('config_exclusions')
        .delete()
        .eq('category', category)
        .eq('source_field', sourceField)
        .eq('source_value', sourceValue)
      if (error) {
        pushToast(`Błąd usuwania: ${error.message}`, 'error')
        return
      }
      pushToast('Grupa wykluczeń usunięta', 'success')
      void fetchExclusions()
    } finally {
      setGlobalLoading(false)
    }
  }

  // ── Dimension map CRUD ──────────────────────────────────────────────────────
  const handleSaveDimensionMap = async () => {
    if (!dimensionMapForm.dimension_code) return
    setGlobalLoading(true)
    try {
      const { error } = await supabase.from('dimension_map').insert(dimensionMapForm)
      if (error) {
        pushToast(`Błąd zapisu: ${error.message}`, 'error')
        return
      }
      pushToast('Dodano wymiar', 'success')
      setDimensionMapForm({ category: 'STA', dimension_code: '', width_mm: 0, height_mm: 0 })
      void fetchDimensionMap()
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleSaveRozmiarWithDimensions = async () => {
    if (!dimensionModalForm.width_mm || !dimensionModalForm.height_mm) return
    if (!pendingRozmiarValue) return
    setGlobalLoading(true)
    try {
      if (editingConfigOption !== null) {
        // EDYCJA: aktualizuj nazwę + wymiary (wcześniej wymiarów nie dało się zmienić)
        const oldCode = editingConfigOption.value
        const { error: optError } = await supabase
          .from('config_options')
          .update({ value: pendingRozmiarValue, sort_order: configOptionForm.sort_order })
          .eq('id', editingConfigOption.id)
        if (optError) {
          pushToast(`Błąd zapisu: ${optError.message}`, 'error')
          return
        }
        await placeConfigOptionAt(selectedConfigCategory, 'rozmiar', editingConfigOption.id, configOptionForm.sort_order)
        const existing = dimensionMap.find(
          (d) => d.category === selectedConfigCategory && d.dimension_code === oldCode,
        )
        const dimPayload = {
          category: selectedConfigCategory,
          dimension_code: pendingRozmiarValue,
          width_mm: dimensionModalForm.width_mm,
          height_mm: dimensionModalForm.height_mm,
        }
        const { error: dimError } = existing
          ? await supabase.from('dimension_map').update(dimPayload).eq('id', existing.id)
          : await supabase.from('dimension_map').insert(dimPayload)
        if (dimError) {
          pushToast(`Błąd zapisu wymiarów: ${dimError.message}`, 'error')
          return
        }
        pushToast('Rozmiar zaktualizowany', 'success')
      } else {
        const { error: optError } = await supabase.from('config_options').insert({
          category: selectedConfigCategory,
          type: 'rozmiar',
          value: pendingRozmiarValue,
          sort_order: configOptionsList.length + 1,
        })
        if (optError) {
          pushToast(`Błąd zapisu: ${optError.message}`, 'error')
          return
        }
        const { error: dimError } = await supabase.from('dimension_map').insert({
          category: selectedConfigCategory,
          dimension_code: pendingRozmiarValue,
          width_mm: dimensionModalForm.width_mm,
          height_mm: dimensionModalForm.height_mm,
        })
        if (dimError) {
          pushToast(`Błąd zapisu wymiarów: ${dimError.message}`, 'error')
          return
        }
        pushToast('Rozmiar dodany', 'success')
      }
      // Zamknij modal i wyzeruj formularz (wcześniej okienko wisiało ze starą kolejnością)
      setConfigAddStep('value')
      setPendingRozmiarValue('')
      setDimensionModalForm({ width_mm: 0, height_mm: 0 })
      setConfigOptionForm({ value: '', sort_order: 0 })
      setEditingConfigOption(null)
      setIsConfigOptionModalOpen(false)
      void fetchConfigOptionsList()
      void fetchDimensionMap()
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleDeleteDimensionMap = async (id: number) => {
    setGlobalLoading(true)
    try {
      await supabase.from('dimension_map').delete().eq('id', id)
      void fetchDimensionMap()
    } finally {
      setGlobalLoading(false)
    }
  }

  // ── Glass allowances CRUD ───────────────────────────────────────────────────
  const handleUpdateGlassAllowance = useCallback(
    async (id: number, field: 'allowance_w_mm' | 'allowance_h_mm', value: number) => {
      const { error } = await supabase
        .from('glass_allowances')
        .update({ [field]: value })
        .eq('id', id)
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      setGlassAllowances((prev) =>
        prev.map((a) => (a.id === id ? { ...a, [field]: value } : a)),
      )
    },
    [pushToast],
  )

  // ── Extension profile CRUD ──────────────────────────────────────────────────
  const handleUpdateExtensionProfileWidth = useCallback(
    async (category: string, value: number) => {
      const { error } = await supabase
        .from('extension_profile_width_map')
        .upsert({ category, profile_width_mm: value }, { onConflict: 'category' })
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      setExtensionProfileWidths((prev) => {
        const exists = prev.some((p) => p.category === category)
        if (!exists) return [...prev, { category, profile_width_mm: value }]
        return prev.map((p) =>
          p.category === category ? { ...p, profile_width_mm: value } : p,
        )
      })
    },
    [pushToast],
  )

  const handleSaveExtensionProfile = async () => {
    if (!extensionProfileForm.profile_width_mm) return
    setGlobalLoading(true)
    try {
      const { error } = await supabase
        .from('extension_profile_width_map')
        .insert(extensionProfileForm)
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      pushToast('Dodano profil', 'success')
      setExtensionProfileForm({ category: 'STA', profile_width_mm: 0 })
      void fetchExtensionProfileWidths()
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleDeleteExtensionProfile = async (category: string) => {
    setGlobalLoading(true)
    try {
      await supabase
        .from('extension_profile_width_map')
        .delete()
        .eq('category', category)
      void fetchExtensionProfileWidths()
    } finally {
      setGlobalLoading(false)
    }
  }

  // ── Return ──────────────────────────────────────────────────────────────────
  return {
    // State
    activeConfigSubTab,
    setActiveConfigSubTab,
    selectedConfigCategory,
    setSelectedConfigCategory,
    selectedConfigDictKey,
    setSelectedConfigDictKey,
    selectedConfigDict,
    selectedConfigDictType,
    configOptionsList,
    internalDoorConfigOptions,
    allConfigDefaults,
    bastionFrameOptions,
    configOptions,
    configOptionsLoading,
    isConfigOptionModalOpen,
    setIsConfigOptionModalOpen,
    isConfigOptionSaving,
    editingConfigOption,
    setEditingConfigOption,
    configOptionForm,
    setConfigOptionForm,
    configAddStep,
    setConfigAddStep,
    pendingRozmiarValue,
    setPendingRozmiarValue,
    draggedItemId,
    setDraggedItemId,
    dragOverItemId,
    setDragOverItemId,
    exclusions,
    exclusionForm,
    setExclusionForm,
    exclusionSourceFilter,
    setExclusionSourceFilter,
    activeExclusionCategory,
    setActiveExclusionCategory,
    exclusionSearch,
    setExclusionSearch,
    dimensionMap,
    dimensionMapForm,
    setDimensionMapForm,
    dimensionModalForm,
    setDimensionModalForm,
    glassAllowances,
    extensionProfileForm,
    setExtensionProfileForm,
    extensionProfileWidths,
    leadTimeRules,
    // Fetch
    fetchLeadTimeRules,
    fetchExclusions,
    fetchDimensionMap,
    fetchExtensionProfileWidths,
    fetchGlassAllowances,
    fetchAllConfigDefaults,
    fetchBastionFrameOptions,
    fetchConfigOptionsList,
    fetchInternalDoorConfigOptions,
    fetchConfigOptionsForExclusions,
    // Config options CRUD
    handleReorderConfigOptions,
    handleToggleConfigOptionDefault,
    handleUpdateLabelMultiplier,
    handleUpdateAddToBatch,
    handleSaveConfigOption,
    handleDeleteConfigOption,
    reorderConfigOptionsSortOrder,
    // Exclusions CRUD
    handleSaveExclusion,
    handleDeleteExclusion,
    handleDeleteExclusionGroup,
    // Dimension map CRUD
    handleSaveDimensionMap,
    handleSaveRozmiarWithDimensions,
    handleDeleteDimensionMap,
    // Glass allowances CRUD
    handleUpdateGlassAllowance,
    // Extension profile CRUD
    handleUpdateExtensionProfileWidth,
    handleSaveExtensionProfile,
    handleDeleteExtensionProfile,
    // Lead time rules CRUD
    handleSaveLeadTimeRule,
    handleDeleteLeadTimeRule,
    handleToggleLeadTimeRuleActive,
  }
}
