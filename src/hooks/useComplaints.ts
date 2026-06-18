import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import { INITIAL_COMPLAINT_FORM_DATA, TABS } from '../constants'
import { generateComplaintNumber } from '../utils'
import { isManagerRole } from '../lib/permissions'
import type {
  ArchivedOrder,
  Complaint,
  ComplaintFormData,
  CurrentUser,
  DeleteConfirmState,
  Order,
  SubTab,
} from '../types'
import type { ToastVariant } from '../types'

type UseComplaintsParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
  activeTab: string
  orders: Order[]
  archivedOrders: ArchivedOrder[]
  currentUser: CurrentUser | null
  setDeleteConfirm: (v: DeleteConfirmState | null) => void
  setActiveTab: (tab: (typeof TABS)[number]) => void
  setActiveSubTab: (tab: SubTab) => void
}

export function useComplaints({
  pushToast,
  touchSession,
  activeTab,
  orders,
  currentUser,
  setActiveTab,
  setActiveSubTab,
}: UseComplaintsParams) {
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [showComplaintForm, setShowComplaintForm] = useState(false)
  const [archivedOrdersForComplaints, setArchivedOrdersForComplaints] = useState<ArchivedOrder[]>([])
  const [cancelComplaintConfirm, setCancelComplaintConfirm] = useState<DeleteConfirmState | null>(null)
  const [complaintFormData, setComplaintFormData] = useState<ComplaintFormData>(INITIAL_COMPLAINT_FORM_DATA)
  const [complaintFormLoading, setComplaintFormLoading] = useState(false)
  const [linkedComplaints, setLinkedComplaints] = useState<Complaint[]>([])

  const isManager = isManagerRole(currentUser?.role)

  const fetchComplaints = useCallback(async () => {
    touchSession()
    const categoryTab = activeTab as string
    if (!['STA', 'Disting', 'ST', 'Techniczne', 'Bastion'].includes(categoryTab)) {
      setComplaints([])
      setLinkedComplaints([])
      return
    }
    const { data, error } = await supabase
      .from('complaints')
      .select('*')
      .eq('category', categoryTab)
      .order('created_at', { ascending: false })
    if (error) {
      console.error(error)
    } else {
      const loaded = (data || []) as Complaint[]
      setComplaints(loaded)

      if (activeTab === 'STA') {
        const linkedCIds = loaded
          .map((c) => c.linked_complaint_id)
          .filter((id): id is number => id != null)
        if (linkedCIds.length > 0) {
          const { data: linkedCData } = await supabase
            .from('complaints')
            .select('*')
            .in('id', linkedCIds)
          setLinkedComplaints((linkedCData || []) as Complaint[])
        } else {
          setLinkedComplaints([])
        }
      } else {
        setLinkedComplaints([])
      }
    }
  }, [activeTab, touchSession])

  const searchOrdersForComplaint = useCallback((o: Order) => {
    setComplaintFormData((prev) => ({
      ...prev,
      order_id: o.id ?? null,
      order_number: o.order_number,
      company: o.company,
      order_date: o.order_date,
      production_day: o.production_day,
      quantity: o.quantity,
      sequence: o.sequence,
      system: o.system,
      model: o.model,
      wing_color: o.wing_color,
      frame_color: o.frame_color,
      threshold_color: o.threshold_color,
      width: o.width,
      direction: o.direction,
      opening: o.opening,
      height: o.height,
      glazing: o.glazing,
      decorative_panel: o.decorative_panel,
      hardware: o.hardware,
      handle: o.handle,
      electric_strike: o.electric_strike,
      peephole: o.peephole,
      top_light: o.top_light,
      top_light_glazing: o.top_light_glazing,
      side_panel: o.side_panel,
      side_panel_glazing: o.side_panel_glazing,
      extension: o.extension,
      release_date: o.release_date ?? null,
      disting_sheet: o.disting_sheet,
      sta_sheet: o.sta_sheet ?? '',
      notes: o.notes,
      client_order_number: o.client_order_number,
      defects: o.defects,
      configurator_value: o.configurator_value,
      info: o.info,
      airtable_id: o.airtable_id,
      label: o.label,
      is_rush: false,
      linked_complaint_id: null,
    }))
  }, [])

  const handleCreateComplaintFromArchive = useCallback(
    (archivedOrder: ArchivedOrder) => {
      setComplaintFormData({
        ...INITIAL_COMPLAINT_FORM_DATA,
        order_id: null,
        order_number: archivedOrder.order_number,
        company: archivedOrder.company,
        order_date: archivedOrder.order_date,
        production_day: archivedOrder.production_day,
        quantity: archivedOrder.quantity,
        sequence: archivedOrder.sequence,
        system: archivedOrder.system,
        model: archivedOrder.model,
        wing_color: archivedOrder.wing_color,
        frame_color: archivedOrder.frame_color,
        threshold_color: archivedOrder.threshold_color,
        width: archivedOrder.width,
        direction: archivedOrder.direction,
        opening: archivedOrder.opening,
        height: archivedOrder.height,
        glazing: archivedOrder.glazing,
        decorative_panel: archivedOrder.decorative_panel,
        hardware: archivedOrder.hardware,
        handle: archivedOrder.handle,
        electric_strike: archivedOrder.electric_strike,
        peephole: archivedOrder.peephole,
        top_light: archivedOrder.top_light,
        top_light_glazing: archivedOrder.top_light_glazing,
        side_panel: archivedOrder.side_panel,
        side_panel_glazing: archivedOrder.side_panel_glazing,
        extension: archivedOrder.extension,
        release_date: archivedOrder.release_date ?? null,
        disting_sheet: archivedOrder.disting_sheet,
        sta_sheet: archivedOrder.sta_sheet ?? '',
        notes: archivedOrder.notes,
        client_order_number: archivedOrder.client_order_number,
        defects: archivedOrder.defects,
        configurator_value: archivedOrder.configurator_value,
        info: archivedOrder.info,
        airtable_id: archivedOrder.airtable_id,
        label: archivedOrder.label,
      })
      setShowComplaintForm(true)
      setActiveTab(archivedOrder.category as (typeof TABS)[number])
      setActiveSubTab('Reklamacje')
    },
    [setActiveTab, setActiveSubTab],
  )

  const handleSaveComplaint = useCallback(async () => {
    touchSession()
    if (!complaintFormData.order_id && !complaintFormData.order_number.trim()) return
    if (!complaintFormData.what_complained?.trim()) {
      pushToast('Wybierz co jest reklamowane', 'error')
      return
    }
    if (!complaintFormData.reason?.trim()) {
      pushToast('Wpisz powód reklamacji', 'error')
      return
    }
    setComplaintFormLoading(true)

    const complaint_number = await generateComplaintNumber()

    const sourceOrder = orders.find((o) => o.id === complaintFormData.order_id)
    const isDistingPlus =
      activeTab === 'Disting' &&
      sourceOrder?.linked_order_id != null &&
      (complaintFormData.what_complained === 'Skrzydło' || complaintFormData.what_complained === 'Komplet')

    if (isDistingPlus && sourceOrder) {
      const { data: staOrderData } = await supabase
        .from('orders')
        .select('*')
        .eq('id', sourceOrder.linked_order_id)
        .single()
      const staOrder = staOrderData as Order | null

      const { data: distComplaint, error: distError } = await supabase
        .from('complaints')
        .insert({
          complaint_number,
          complaint_date: new Date().toISOString().split('T')[0],
          category: 'Disting',
          order_id: complaintFormData.order_id,
          order_number: complaintFormData.order_number ?? '',
          company: complaintFormData.company ?? '',
          what_complained: complaintFormData.what_complained ?? '',
          reason: complaintFormData.reason ?? '',
          created_by: currentUser?.initials?.trim() || currentUser?.full_name || '',
          order_date: complaintFormData.order_date ?? '',
          production_day: complaintFormData.production_day ?? '',
          quantity: complaintFormData.quantity,
          sequence: complaintFormData.sequence ?? '',
          system: complaintFormData.system ?? '',
          model: complaintFormData.model ?? '',
          wing_color: complaintFormData.wing_color ?? '',
          frame_color: complaintFormData.frame_color ?? '',
          threshold_color: complaintFormData.threshold_color ?? '',
          width: complaintFormData.width ?? '',
          direction: complaintFormData.direction ?? '',
          opening: complaintFormData.opening ?? '',
          height: complaintFormData.height ?? '',
          glazing: complaintFormData.glazing ?? '',
          decorative_panel: complaintFormData.decorative_panel ?? '',
          hardware: complaintFormData.hardware ?? '',
          handle: complaintFormData.handle ?? '',
          electric_strike: complaintFormData.electric_strike ?? '',
          peephole: complaintFormData.peephole ?? '',
          top_light: complaintFormData.top_light ?? '',
          top_light_glazing: complaintFormData.top_light_glazing ?? '',
          side_panel: complaintFormData.side_panel ?? '',
          side_panel_glazing: complaintFormData.side_panel_glazing ?? '',
          extension: complaintFormData.extension ?? '',
          release_date: complaintFormData.release_date ?? null,
          disting_sheet: complaintFormData.disting_sheet ?? '',
          sta_sheet: complaintFormData.sta_sheet ?? '',
          notes: complaintFormData.notes ?? '',
          client_order_number: complaintFormData.client_order_number ?? '',
          defects: complaintFormData.defects ?? '',
          configurator_value: complaintFormData.configurator_value ?? '',
          info: complaintFormData.info ?? '',
          airtable_id: complaintFormData.airtable_id ?? '',
          label: complaintFormData.label ?? '',
          is_rush: complaintFormData.is_rush,
          production_stages: {},
          linked_complaint_id: null,
        })
        .select()
        .single()

      if (distError || !distComplaint) {
        console.error('Błąd zapisu reklamacji Disting:', JSON.stringify(distError))
        alert('Błąd zapisu reklamacji Disting')
        setComplaintFormLoading(false)
        return
      }

      const { data: staComplaint, error: staError } = await supabase
        .from('complaints')
        .insert({
          complaint_number,
          complaint_date: new Date().toISOString().split('T')[0],
          category: 'STA',
          order_id: staOrder?.id ?? null,
          order_number: String(staOrder?.order_number ?? ''),
          company: complaintFormData.company ?? '',
          what_complained: complaintFormData.what_complained ?? '',
          reason: complaintFormData.reason ?? '',
          created_by: currentUser?.initials?.trim() || currentUser?.full_name || '',
          order_date: staOrder?.order_date ?? '',
          production_day: staOrder?.production_day ?? '',
          quantity: staOrder?.quantity ?? 1,
          sequence: staOrder?.sequence ?? '',
          system: staOrder?.system ?? '',
          model: staOrder?.model ?? '',
          wing_color: staOrder?.wing_color ?? '',
          frame_color: staOrder?.frame_color ?? '',
          threshold_color: staOrder?.threshold_color ?? '',
          width: staOrder?.width ?? '',
          direction: staOrder?.direction ?? '',
          opening: staOrder?.opening ?? '',
          height: staOrder?.height ?? '',
          glazing: staOrder?.glazing ?? '',
          decorative_panel: staOrder?.decorative_panel ?? '',
          hardware: staOrder?.hardware ?? '',
          handle: staOrder?.handle ?? '',
          electric_strike: staOrder?.electric_strike ?? '',
          peephole: staOrder?.peephole ?? '',
          top_light: staOrder?.top_light ?? '',
          top_light_glazing: staOrder?.top_light_glazing ?? '',
          side_panel: staOrder?.side_panel ?? '',
          side_panel_glazing: staOrder?.side_panel_glazing ?? '',
          extension: staOrder?.extension ?? '',
          release_date: staOrder?.release_date ?? null,
          disting_sheet: staOrder?.disting_sheet ?? '',
          sta_sheet: staOrder?.sta_sheet ?? '',
          notes: staOrder?.notes ?? '',
          client_order_number: staOrder?.client_order_number ?? '',
          defects: staOrder?.defects ?? '',
          configurator_value: staOrder?.configurator_value ?? '',
          info: staOrder?.info ?? '',
          airtable_id: staOrder?.airtable_id ?? '',
          label: staOrder?.label ?? '',
          is_rush: false,
          production_stages: {},
          linked_complaint_id: (distComplaint as Complaint).id ?? null,
        })
        .select()
        .single()

      if (staError || !staComplaint) {
        console.error(staError)
        alert('Błąd zapisu reklamacji STA')
        setComplaintFormLoading(false)
        return
      }

      await supabase
        .from('complaints')
        .update({ linked_complaint_id: (staComplaint as Complaint).id })
        .eq('id', (distComplaint as Complaint).id!)
    } else {
      const { error } = await supabase.from('complaints').insert({
        complaint_number,
        complaint_date: new Date().toISOString().split('T')[0],
        category: activeTab as string,
        order_id: complaintFormData.order_id,
        order_number: complaintFormData.order_number ?? '',
        company: complaintFormData.company ?? '',
        what_complained: complaintFormData.what_complained ?? '',
        reason: complaintFormData.reason ?? '',
        created_by: currentUser?.initials?.trim() || currentUser?.full_name || '',
        order_date: complaintFormData.order_date ?? '',
        production_day: complaintFormData.production_day ?? '',
        quantity: complaintFormData.quantity,
        sequence: complaintFormData.sequence ?? '',
        system: complaintFormData.system ?? '',
        model: complaintFormData.model ?? '',
        wing_color: complaintFormData.wing_color ?? '',
        frame_color: complaintFormData.frame_color ?? '',
        threshold_color: complaintFormData.threshold_color ?? '',
        width: complaintFormData.width ?? '',
        direction: complaintFormData.direction ?? '',
        opening: complaintFormData.opening ?? '',
        height: complaintFormData.height ?? '',
        glazing: complaintFormData.glazing ?? '',
        decorative_panel: complaintFormData.decorative_panel ?? '',
        hardware: complaintFormData.hardware ?? '',
        handle: complaintFormData.handle ?? '',
        electric_strike: complaintFormData.electric_strike ?? '',
        peephole: complaintFormData.peephole ?? '',
        top_light: complaintFormData.top_light ?? '',
        top_light_glazing: complaintFormData.top_light_glazing ?? '',
        side_panel: complaintFormData.side_panel ?? '',
        side_panel_glazing: complaintFormData.side_panel_glazing ?? '',
        extension: complaintFormData.extension ?? '',
        release_date: complaintFormData.release_date ?? null,
        disting_sheet: complaintFormData.disting_sheet ?? '',
        sta_sheet: complaintFormData.sta_sheet ?? '',
        notes: complaintFormData.notes ?? '',
        client_order_number: complaintFormData.client_order_number ?? '',
        defects: complaintFormData.defects ?? '',
        configurator_value: complaintFormData.configurator_value ?? '',
        info: complaintFormData.info ?? '',
        airtable_id: complaintFormData.airtable_id ?? '',
        label: complaintFormData.label ?? '',
        is_rush: complaintFormData.is_rush,
        production_stages: {},
        linked_complaint_id: null,
      })
      if (error) {
        console.error(error)
        alert('Błąd zapisu reklamacji')
        setComplaintFormLoading(false)
        return
      }
    }

    setComplaintFormLoading(false)
    setShowComplaintForm(false)
    setComplaintFormData(INITIAL_COMPLAINT_FORM_DATA)
    void fetchComplaints()
  }, [complaintFormData, activeTab, orders, currentUser, fetchComplaints, touchSession])

  const handleRestoreComplaint = useCallback(
    async (complaint: Complaint) => {
      if (!isManager) return
      if (complaint.id === undefined) {
        pushToast('Brak identyfikatora reklamacji', 'error')
        return
      }
      const linkedId = complaint.linked_complaint_id
      const isDistingPlus = complaint.category === 'Disting' && linkedId != null

      const currentExtra = {
        ...(typeof complaint.extra_fields === 'object' && complaint.extra_fields !== null
          ? (complaint.extra_fields as Record<string, unknown>)
          : {}),
        cancelled: false,
        cancelled_at: '',
        cancelled_by: '',
      }
      const { error: upErr } = await supabase
        .from('complaints')
        .update({ extra_fields: currentExtra })
        .eq('id', complaint.id)
      if (upErr) {
        pushToast(`Wystąpił błąd: ${upErr.message}`, 'error')
        return
      }

      if (isDistingPlus && linkedId != null) {
        const { data: linkedRow, error: fetchErr } = await supabase
          .from('complaints')
          .select('extra_fields')
          .eq('id', linkedId)
          .single()
        if (fetchErr) {
          pushToast(`Nie udało się odczytać powiązanej reklamacji: ${fetchErr.message}`, 'error')
          void fetchComplaints()
          return
        }
        const linkedExtra = {
          ...(typeof (linkedRow as { extra_fields?: unknown })?.extra_fields === 'object' &&
          (linkedRow as { extra_fields?: unknown })?.extra_fields !== null
            ? ((linkedRow as { extra_fields?: unknown }).extra_fields as Record<string, unknown>)
            : {}),
          cancelled: false,
          cancelled_at: '',
          cancelled_by: '',
        }
        const { error: linkErr } = await supabase
          .from('complaints')
          .update({ extra_fields: linkedExtra })
          .eq('id', linkedId)
        if (linkErr) {
          pushToast(`Nie udało się przywrócić powiązania: ${linkErr.message}`, 'error')
          void fetchComplaints()
          return
        }
      }

      void fetchComplaints()
    },
    [isManager, fetchComplaints, pushToast],
  )

  const handleCancelComplaintClick = useCallback(
    (complaint: Complaint) => {
      if (!isManager) return
      const id = complaint.id
      if (id === undefined) {
        pushToast('Brak identyfikatora reklamacji', 'error')
        return
      }
      const linkedId = complaint.linked_complaint_id
      const isDistingPlus = complaint.category === 'Disting' && linkedId != null

      const baseMsg = `Czy na pewno chcesz anulować reklamację nr ${complaint.complaint_number}?`
      const message = isDistingPlus
        ? `Ta reklamacja jest powiązana z reklamacją STA. Powiązana reklamacja zostanie oznaczona jako anulowana. ${baseMsg}`
        : baseMsg

      setCancelComplaintConfirm({
        title: 'Anuluj reklamację',
        confirmLabel: 'Anuluj reklamację',
        cancelLabel: 'Wróć',
        message,
        runDelete: async () => {
          const cancelledAt = new Date().toISOString()
          const cancelledBy = currentUser?.initials?.trim() ?? ''
          const currentExtra = {
            ...(typeof complaint.extra_fields === 'object' && complaint.extra_fields !== null
              ? (complaint.extra_fields as Record<string, unknown>)
              : {}),
            cancelled: true,
            cancelled_at: cancelledAt,
            cancelled_by: cancelledBy,
          }

          const { error } = await supabase.from('complaints').update({ extra_fields: currentExtra }).eq('id', id)
          if (error) {
            pushToast(`Wystąpił błąd: ${error.message}`, 'error')
            return
          }

          if (isDistingPlus && linkedId != null) {
            const { data: linkedRow, error: fetchErr } = await supabase
              .from('complaints')
              .select('extra_fields')
              .eq('id', linkedId)
              .single()
            if (fetchErr) {
              pushToast(`Nie udało się odczytać powiązanej reklamacji: ${fetchErr.message}`, 'error')
              void fetchComplaints()
              return
            }
            const linkedExtra = {
              ...(typeof (linkedRow as { extra_fields?: unknown })?.extra_fields === 'object' &&
              (linkedRow as { extra_fields?: unknown })?.extra_fields !== null
                ? ((linkedRow as { extra_fields?: unknown }).extra_fields as Record<string, unknown>)
                : {}),
              cancelled: true,
              cancelled_at: cancelledAt,
              cancelled_by: cancelledBy,
            }
            const { error: linkErr } = await supabase
              .from('complaints')
              .update({ extra_fields: linkedExtra })
              .eq('id', linkedId)
            if (linkErr) {
              pushToast(`Nie udało się oznaczyć powiązania: ${linkErr.message}`, 'error')
              void fetchComplaints()
              return
            }
          }

          void fetchComplaints()
        },
      })
    },
    [isManager, currentUser, fetchComplaints, pushToast],
  )

  const handleComplaintStageClick = useCallback(
    async (
      complaintId: number,
      stageKey: string,
      currentStages: Record<string, string>,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _category: string,
    ) => {
      const currentValue = currentStages[stageKey] ?? ''
      const filled = Boolean(currentValue.trim())
      const newValue = filled ? '' : currentUser?.initials?.trim() || 'T'
      const updatedStages = { ...currentStages, [stageKey]: newValue }

      const { error } = await supabase
        .from('complaints')
        .update({ production_stages: updatedStages })
        .eq('id', complaintId)

      if (error) {
        console.error(error)
        return
      }
      void fetchComplaints()
    },
    [currentUser, fetchComplaints],
  )

  const handleComplaintRushToggle = useCallback(
    async (complaint: Complaint, checked: boolean) => {
      if (!isManager) return
      const id = complaint.id
      if (id === undefined) {
        pushToast('Brak identyfikatora reklamacji', 'error')
        return
      }
      if (complaint.is_rush === checked) return
      const { error } = await supabase.from('complaints').update({ is_rush: checked }).eq('id', id)
      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        return
      }
      setComplaints((prev) => prev.map((c) => (c.id === id ? { ...c, is_rush: checked } : c)))
    },
    [isManager, pushToast],
  )

  return {
    complaints,
    setComplaints,
    showComplaintForm,
    setShowComplaintForm,
    archivedOrdersForComplaints,
    setArchivedOrdersForComplaints,
    cancelComplaintConfirm,
    setCancelComplaintConfirm,
    complaintFormData,
    setComplaintFormData,
    complaintFormLoading,
    setComplaintFormLoading,
    linkedComplaints,
    setLinkedComplaints,
    fetchComplaints,
    searchOrdersForComplaint,
    handleCreateComplaintFromArchive,
    handleSaveComplaint,
    handleRestoreComplaint,
    handleCancelComplaintClick,
    handleComplaintStageClick,
    handleComplaintRushToggle,
  }
}
