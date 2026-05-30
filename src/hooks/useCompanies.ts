import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import { INITIAL_CONTRACTOR_FORM } from '../constants'
import type { Company, ContractorFormData, CurrentUser, DeleteConfirmState } from '../types'
import type { ToastVariant } from '../types'

type UseCompaniesParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
  setDeleteConfirm: (v: DeleteConfirmState | null) => void
  currentUser: CurrentUser | null
}

export function useCompanies({ pushToast, touchSession, setDeleteConfirm, currentUser }: UseCompaniesParams) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(true)
  const [isContractorModalOpen, setIsContractorModalOpen] = useState(false)
  const [isContractorSaving, setIsContractorSaving] = useState(false)
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [contractorSearchTerm, setContractorSearchTerm] = useState('')
  const [contractorFormData, setContractorFormData] = useState<ContractorFormData>(INITIAL_CONTRACTOR_FORM)

  const isManager = currentUser?.role === 'manager'

  const fetchCompanies = useCallback(async () => {
    touchSession()
    setCompanies([])
    setCompaniesLoading(true)
    let allCompanies: Company[] = []
    let from = 0
    const batchSize = 1000

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .order('name')
        .range(from, from + batchSize - 1)

      if (error) {
        console.error(error)
        allCompanies = []
        break
      }
      if (!data || data.length === 0) break

      const batch: Company[] = data.map((item) => ({
        id: Number(item.id),
        name: String(item.name ?? ''),
        city: String(item.city ?? ''),
        route_day: String(item.route_day ?? ''),
        production_day: String(item.production_day ?? ''),
      }))
      allCompanies = [...allCompanies, ...batch]
      if (data.length < batchSize) break
      from += batchSize
    }

    setCompanies(allCompanies)
    setCompaniesLoading(false)
  }, [touchSession])

  const handleContractorFormChange = (field: keyof ContractorFormData, value: string) => {
    setContractorFormData((prev) => ({ ...prev, [field]: value }))
  }

  const openAddContractorModal = () => {
    setEditingCompany(null)
    setContractorFormData(INITIAL_CONTRACTOR_FORM)
    setIsContractorModalOpen(true)
  }

  const handleEditCompany = (company: Company) => {
    if (!isManager) return
    console.log('editing:', company)
    setEditingCompany(company)
    setContractorFormData({
      name: company.name || '',
      city: company.city || '',
      route_day: company.route_day || 'PONIEDZIAŁEK',
      production_day: company.production_day || 'PONIEDZIAŁEK',
    })
    setIsContractorModalOpen(true)
  }

  const handleSaveContractor = async () => {
    if (editingCompany !== null && !isManager) {
      pushToast('Brak uprawnień do edycji kontrahenta', 'error')
      return
    }
    setIsContractorSaving(true)
    const payload = {
      name: contractorFormData.name,
      city: contractorFormData.city,
      route_day: contractorFormData.route_day,
      production_day: contractorFormData.production_day,
    }

    const { error } =
      editingCompany === null
        ? await supabase.from('companies').insert([payload])
        : await supabase.from('companies').update(payload).eq('id', editingCompany.id)

    if (error) {
      pushToast(`Wystąpił błąd: ${error.message}`, 'error')
      setIsContractorSaving(false)
      return
    }

    pushToast(
      editingCompany === null ? 'Kontrahent został dodany pomyślnie' : 'Kontrahent został zaktualizowany',
      'success',
    )
    setIsContractorModalOpen(false)
    await fetchCompanies()
    setIsContractorSaving(false)
  }

  const handleDeleteContractor = (company: Company) => {
    if (!isManager) return
    setDeleteConfirm({
      message: `Czy na pewno chcesz usunąć kontrahenta „${company.name}"?`,
      runDelete: async () => {
        const { error } = await supabase.from('companies').delete().eq('id', company.id)
        if (error) {
          pushToast(`Wystąpił błąd: ${error.message}`, 'error')
          return
        }
        pushToast('Kontrahent został usunięty', 'success')
        await fetchCompanies()
      },
    })
  }

  return {
    companies,
    setCompanies,
    companiesLoading,
    setCompaniesLoading,
    isContractorModalOpen,
    setIsContractorModalOpen,
    isContractorSaving,
    setIsContractorSaving,
    editingCompany,
    setEditingCompany,
    showCompanyDropdown,
    setShowCompanyDropdown,
    highlightedIndex,
    setHighlightedIndex,
    contractorSearchTerm,
    setContractorSearchTerm,
    contractorFormData,
    setContractorFormData,
    fetchCompanies,
    handleContractorFormChange,
    openAddContractorModal,
    handleEditCompany,
    handleSaveContractor,
    handleDeleteContractor,
  }
}
