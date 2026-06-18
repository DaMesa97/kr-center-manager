import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent,
} from 'react'
import './App.css'
import { supabase } from './supabaseClient'
import { useToasts } from './hooks/useToasts'
import { useAuth } from './hooks/useAuth'
import { useWarehouse } from './hooks/useWarehouse'
import { useConfig } from './hooks/useConfig'
import { useAudit } from './hooks/useAudit'
import { useArchive } from './hooks/useArchive'
import { useMyStation } from './hooks/useMyStation'
import { useOrderComments } from './hooks/useOrderComments'
import { useStats } from './hooks/useStats'
import { useUsers } from './hooks/useUsers'
import { useCompanies } from './hooks/useCompanies'
import { useShipping } from './hooks/useShipping'
import { useComplaints } from './hooks/useComplaints'
import { useOrders } from './hooks/useOrders'
import { useApiKeys } from './hooks/useApiKeys'
import {
  CONFIG_DICTIONARIES,
  EXCLUSION_FIELD_LABELS,
  EXCLUSION_FIELD_TO_OPTION_TYPE,
  INITIAL_COMPLAINT_FORM_DATA,
  INITIAL_USER_FORM,
  ST_MIXED_STAGE_DEFS,
  ST_STAGE_DEFS,
  ST_TITAN_STAGE_DEFS,
  TABS,
} from './constants'
import {
  canEditBastionSalesChanges,
  calcExtensionDims,
  getExtQty,
  getOrderAgeStatus,
  getTableStageDefinitions,
  isExtSideActive,
  isFieldValueExcluded,
  isReleaseDateEmpty,
  isStTitanOrder,
  isStTitanSystemLabel,
  profileDepartmentLabel,
  profileRoleLabel,
  setExtQty,
  tabsForUserDepartment,
} from './utils'
import DeleteConfirmDialog from './components/DeleteConfirmDialog'
import GlobalSpinner from './components/GlobalSpinner'
import ToastStack from './components/ToastStack'
import StageRevertPopup from './components/StageRevertPopup'
import ReleaseClearPopup from './components/ReleaseClearPopup'
import UsersView from './components/UsersView'
import CompaniesView from './components/CompaniesView'
import GlassView from './components/GlassView'
import ConfigView from './components/ConfigView'
import ComplaintsView from './components/ComplaintsView'
import StOrdersTableView from './components/StOrdersTableView'
import TechniczneOrdersTableView from './components/TechniczneOrdersTableView'
import StaDistingOrdersTableView from './components/StaDistingOrdersTableView'
import BastionOrdersTableView from './components/BastionOrdersTableView'
import InternalDoorOrdersTable from './components/InternalDoorOrdersTable'
import OrderFormModal from './components/OrderFormModal'
import StatsView from './components/StatsView'
import WarehouseView from './components/WarehouseView'
import DocumentDetailsModal from './components/warehouse/DocumentDetailsModal'
import MmFormModal from './components/warehouse/MmFormModal'
import PzFormModal from './components/warehouse/PzFormModal'
import RecipeEditorModal from './components/warehouse/RecipeEditorModal'
import FinishedDoorComponentFormModal from './components/warehouse/FinishedDoorComponentFormModal'
import ComponentHistoryModal from './components/warehouse/ComponentHistoryModal'
import SessionWarningModal from './components/SessionWarningModal'
import AuditLogView from './components/AuditLogView'
import OrderHistoryModal from './components/OrderHistoryModal'
import ArchiveView from './components/ArchiveView'
import ShippingView from './components/ShippingView'
import ShippingDetailsModal from './components/ShippingDetailsModal'
import WorkerStagesModal from './components/WorkerStagesModal'
import MyStationView from './components/MyStationView'
import OrderCommentsPanel from './components/OrderCommentsPanel'
import AppHeader from './components/AppHeader'
import Sidebar from './components/Sidebar'
import LabelsView from './components/LabelsView'
import HelpView from './components/HelpView'
import FeedbackView from './components/FeedbackView'
import FeedbackFab from './components/FeedbackFab'
import PrintLabelModal from './components/PrintLabelModal'
import { can, isManagerRole } from './lib/permissions'
import InternalDoorOrderModal from './components/InternalDoorOrderModal'
import InternalDoorOrderDetailsModal from './components/InternalDoorOrderDetailsModal'
import OrdersNeedingReviewView from './components/OrdersNeedingReviewView'
import SupplierFormModal from './components/config/SupplierFormModal'
import ShoppingListModal from './components/warehouse/ShoppingListModal'
import PurchaseOrderDetailsModal from './components/warehouse/PurchaseOrderDetailsModal'
import PurchaseOrderReceiveModal from './components/warehouse/PurchaseOrderReceiveModal'
import ContractorModal from './components/ContractorModal'
import ConfigOptionModal from './components/ConfigOptionModal'
import UserModal from './components/UserModal'
import ComplaintFormModal from './components/ComplaintFormModal'
import OrdersFilters from './components/OrdersFilters'
import ApiKeysView from './components/ApiKeysView'
import UpdateBanner from './components/UpdateBanner'
import UpdateBlocker from './components/UpdateBlocker'
import OverdueBanner from './components/OverdueBanner'
import GlobalSearch, { type SearchResult } from './components/GlobalSearch'
import DashboardView from './components/DashboardView'
import Spinner from './components/Spinner'
import type {
  ArchivedOrder,
  Complaint,
  ConfigExclusion,
  ConfigOptionRecord,
  DeleteConfirmState,
  Order,
  StaConfigRow,
  SubTab,
  WarehouseSubTab,
} from './types'

function LoginScreen({
  username,
  password,
  submitting,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: {
  username: string
  password: string
  submitting: boolean
  onUsernameChange: (v: string) => void
  onPasswordChange: (v: string) => void
  onSubmit: (e: FormEvent) => void
}) {
  return (
    <main className="login-screen">
      <div className="login-card">
        <h1 className="login-title">System Zamówień</h1>
        <form className="login-form" onSubmit={onSubmit}>
          <label className="login-field">
            <span className="login-label">Nazwa użytkownika</span>
            <input
              type="text"
              className="login-input"
              autoComplete="username"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
              disabled={submitting}
            />
          </label>
          <label className="login-field">
            <span className="login-label">Hasło</span>
            <input
              type="password"
              className="login-input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
              disabled={submitting}
            />
          </label>
          <button type="submit" className="btn btn-success" disabled={submitting}>
            {submitting ? 'Logowanie…' : 'Zaloguj się'}
          </button>
        </form>
      </div>
    </main>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>('STA')
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('Zamówienia')
  const [activeWarehouseSubTab, setActiveWarehouseSubTab] = useState<WarehouseSubTab>('Stany')
  const { toasts, pushToast, dismissToast } = useToasts()
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null)
  const [globalLoading, setGlobalLoading] = useState(false)
  const [wykonawcaFilter, setWykonawcaFilter] = useState<string[]>([])
  const [isFilterPending, startFilterTransition] = useTransition()
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const didSetDefaultTabRef = useRef(false)

  // Refs for circular dependency between useWarehouse <-> useOrders
  const fetchOrdersRef = useRef(async () => {})
  const setOrdersRef = useRef<React.Dispatch<React.SetStateAction<Order[]>>>(() => {})
  const setAlertsBadgeCountRef = useRef<(n: number) => void>(() => {})

  const {
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
    fetchExclusions,
    fetchDimensionMap,
    fetchExtensionProfileWidths,
    fetchGlassAllowances,
    fetchAllConfigDefaults,
    fetchBastionFrameOptions,
    fetchConfigOptionsList,
    fetchInternalDoorConfigOptions,
    fetchConfigOptionsForExclusions,
    handleReorderConfigOptions,
    handleToggleConfigOptionDefault,
    handleUpdateLabelMultiplier,
    handleUpdateAddToBatch,
    handleSaveConfigOption,
    handleDeleteConfigOption,
    handleSaveExclusion,
    handleDeleteExclusion,
    handleDeleteExclusionGroup,
    handleSaveDimensionMap,
    handleSaveRozmiarWithDimensions,
    handleDeleteDimensionMap,
    handleUpdateGlassAllowance,
    handleUpdateExtensionProfileWidth,
    handleSaveExtensionProfile,
    handleDeleteExtensionProfile,
    leadTimeRules,
    fetchLeadTimeRules,
    handleSaveLeadTimeRule,
    handleDeleteLeadTimeRule,
    handleToggleLeadTimeRuleActive,
  } = useConfig({ pushToast, setGlobalLoading, setDeleteConfirm })

  const resetAppStateAfterLogoutRef = useRef<() => void>(() => {})

  const {
    authSession,
    authReady,
    currentUser,
    loginUsername,
    setLoginUsername,
    loginPassword,
    setLoginPassword,
    loginSubmitting,
    sessionWarningOpen,
    touchSession,
    handleLoginSubmit,
    handleSignOut,
    handleExtendSession,
    handleAutoLogout,
    reloadProfile,
  } = useAuth({ pushToast, onLogout: () => resetAppStateAfterLogoutRef.current() })

  // Ładowanie konfiguracji przy starcie sesji
  useEffect(() => {
    if (!authSession) return
    void fetchExclusions()
    void fetchDimensionMap()
    void fetchExtensionProfileWidths()
    void fetchGlassAllowances()
    void fetchAllConfigDefaults()
    void fetchBastionFrameOptions()
    void fetchLeadTimeRules()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authSession])

  const isManager = isManagerRole(currentUser?.role)
  // Ceny: legacy role bez zmian (manager/worker/sprzedawca widzą), nowe role wg uprawnień
  const canSeePrices = (() => {
    const r = currentUser?.role ?? ''
    if (r === '' || r === 'manager' || r === 'worker' || r === 'sprzedawca') return true
    return can(r, 'prices.view')
  })()
  const canSeeReorderTab =
    isManager || (currentUser?.role === 'worker' && currentUser?.department === 'magazyn')
  const canSeePurchaseOrdersTab = canSeeReorderTab

  const isWarehouseTab = activeTab === 'Magazyn'
  // Taby które potrzebują danych magazynowych (stany, komponenty, smart ROP, dostawcy)
  const isWarehouseDataTab =
    activeTab === 'Magazyn' || activeTab === 'Zamawianie' || activeTab === 'Inwentaryzacja'

  const {
    warehouseComponents,
    warehouseComponentsLoading,
    warehouseRecipes,
    warehouseRecipesLoading,
    showDeletedRecipes,
    setShowDeletedRecipes,
    warehouses,
    warehouseStock,
    warehouseStockLoading,
    warehouseMovements,
    warehouseMovementsLoading,
    pzGroups,
    pzGroupsLoading,
    pzFormOpen,
    setPzFormOpen,
    pzFormData,
    pzSaving,
    mmGroups,
    mmGroupsLoading,
    mmFormOpen,
    setMmFormOpen,
    mmFormData,
    mmSaving,
    monthlyConsumption,
    monthlyConsumptionMonths,
    monthlyConsumptionLoading,
    monthlyConsumptionRange,
    setMonthlyConsumptionRange,
    doorComponentModal,
    setDoorComponentModal,
    componentHistoryModal,
    docDetailsModal,
    recipeEditorOpen,
    setRecipeEditorOpen,
    recipeEditorMode,
    recipeFormData,
    recipeSaving,
    suppliers,
    suppliersLoading,
    supplierModal,
    shoppingList,
    shoppingListModalOpen,
    setShoppingListModalOpen,
    smartRopData,
    smartRopLoading,
    purchaseOrders,
    purchaseOrderItems,
    purchaseOrdersLoading,
    poDetailsModal,
    poReceiveModal,
    companySettings,
    companySettingsLoading,
    warehouseEditRequestComponent,
    setWarehouseEditRequestComponent,
    ordersNeedingReview,
    setOrdersNeedingReview,
    reviewLoading,
    fetchWarehouseComponents,
    fetchWarehouseRecipes,
    fetchWarehouses,
    fetchWarehouseStock,
    fetchWarehouseMovements,
    fetchPzGroups,
    fetchMmGroups,
    fetchMonthlyConsumption,
    fetchSuppliers,
    fetchCompanySettings,
    fetchPurchaseOrders,
    fetchSmartRop,
    fetchOrdersNeedingReview,
    handleCreateWarehouseComponent,
    handleUpdateWarehouseComponent,
    handleSetComponentWarehouses,
    handleCleanupOrphanStock,
    consumeStockForOrderWithToasts,
    syncWarehouseStockAfterOrderEdit,
    handleDeleteRecipe,
    handleToggleRecipeActive,
    handleRestoreRecipe,
    handleOpenRecipeEditor,
    handleEditRecipe,
    handleRecipeFormChange,
    handleRecipeComponentChange,
    handleAddRecipeComponent,
    handleRemoveRecipeComponent,
    handleSaveRecipe,
    openAddDoorComponent,
    openEditDoorComponent,
    openComponentHistory,
    closeComponentHistory,
    handleOpenPzForm,
    handlePzFormChange,
    handlePzItemChange,
    handleAddPzItem,
    handleRemovePzItem,
    handleSavePz,
    handlePzPreview,
    handleCloseDocDetails,
    handleOpenMmForm,
    handleMmFormChange,
    handleMmItemChange,
    handleAddMmItem,
    handleRemoveMmItem,
    handleSaveMm,
    handleMmPreview,
    openCreateSupplier,
    openEditSupplier,
    closeSupplierModal,
    toggleSupplierActive,
    handleAddToShoppingList,
    handleRemoveFromShoppingList,
    handleUpdateShoppingListQuantity,
    handleClearShoppingList,
    openPoDetails,
    closePoDetails,
    openPoReceive,
    closePoReceive,
    onPoAfterAction,
    openComponentEditFromDashboard,
  } = useWarehouse({
    pushToast,
    touchSession,
    activeTab,
    isWarehouseTab: isWarehouseDataTab,
    activeWarehouseSubTab,
    setActiveWarehouseSubTab,
    setOrders: (v) => setOrdersRef.current(v),
    fetchOrders: () => fetchOrdersRef.current(),
    setDeleteConfirm,
    setAlertsBadgeCount: (n) => setAlertsBadgeCountRef.current(n),
  })

  const {
    auditLog,
    auditLoading,
    auditFilters,
    setAuditFilters,
    fetchAuditLog,
  } = useAudit({ pushToast, touchSession })

  const {
    archivedOrders,
    archivedOrdersLoading,
    archiveRunLogs,
    fetchArchivedOrders,
  } = useArchive({ pushToast, touchSession })

  const {
    myStationOrders,
    myStationLoading,
    workerStagesForCurrent,
    workerStagesModal,
    setWorkerStagesModal,
    fetchMyWorkerStages,
    fetchMyStationOrders,
    handleStageComplete,
  } = useMyStation({ pushToast, currentUser })

  const {
    profilesList,
    setProfilesList,
    profilesLoading,
    userModalOpen,
    setUserModalOpen,
    userModalMode,
    setEditingProfileId,
    userForm,
    setUserForm,
    userModalSaving,
    fetchProfiles,
    openAddUserModal,
    openEditUserModal,
    closeUserModal,
    handleSaveUser,
    handleDeleteUserClick,
  } = useUsers({ pushToast, touchSession, currentUser, reloadProfile, setDeleteConfirm, authSession })

  const {
    companies,
    setCompanies,
    companiesLoading,
    isContractorModalOpen,
    setIsContractorModalOpen,
    isContractorSaving,
    editingCompany,
    showCompanyDropdown,
    setShowCompanyDropdown,
    highlightedIndex,
    setHighlightedIndex,
    contractorSearchTerm,
    setContractorSearchTerm,
    contractorFormData,
    fetchCompanies,
    handleContractorFormChange,
    openAddContractorModal,
    handleEditCompany,
    handleSaveContractor,
    handleDeleteContractor,
  } = useCompanies({ pushToast, touchSession, setDeleteConfirm, currentUser })

  const {
    alertsBadgeCount,
    setAlertsBadgeCount,
    orders,
    setOrders,
    internalDoorItems,
    linkedOrders,
    loading,
    isModalOpen,
    setIsModalOpen,
    internalDoorOrderModal,
    setInternalDoorOrderModal,
    internalDoorDetailsModal,
    setInternalDoorDetailsModal,
    editingOrderId,
    setEditingOrderId,
    editingOrderBaseline,
    setEditingOrderBaseline,
    isSaving,
    formData,
    staFormData,
    setStaFormData,
    stFormData,
    bastionFormData,
    techniczneFormData,
    orderFormErrors,
    setOrderFormErrors,
    orderModalConfigRows,
    setOrderModalConfigRows,
    searchTerm,
    setSearchTerm,
    selectedProductionDay,
    setSelectedProductionDay,
    hideCompletedOrders,
    setHideCompletedOrders,
    showCancelledOrders,
    setShowCancelledOrders,
    sourceFilter,
    setSourceFilter,
    stageRevertTarget,
    setStageRevertTarget,
    productionStageUpdating,
    releaseClearTarget,
    setReleaseClearTarget,
    releaseDateUpdating,
    rushUpdatingOrderId,
    setRushUpdatingOrderId,
    historyModal,
    setHistoryModal,
    topLightDimsFilled,
    sidePanelAFilled,
    sidePanelBFilled,
    autoTopLightWidth,
    autoSidePanelHeight,
    filteredCompanies,
    filteredStaCompanies,
    filteredStCompanies,
    filteredBastionCompanies,
    filteredTechniczneCompanies,
    fetchAlertsBadgeCount,
    submitOnEnterInInput,
    applyReleaseDateUpdate,
    toggleOscReceived,
    markProductionStageWithProfileInitials,
    fetchInternalDoorItemsForVisibleOrders,
    fetchOrders,
    handleFormChange,
    handleCompanySelect,
    handleStaCompanySelect,
    handleStaFormChange,
    handleStFormChange,
    handleStCompanySelect,
    handleBastionFormChange,
    handleBastionCompanySelect,
    handleTechniczneFormChange,
    handleTechniczneCompanySelect,
    handleCompanyAutocompleteKeyDown,
    sendGlassOrderWebhook,
    handleSaveOrder,
    openNewOrderModal,
    openCreateInternalDoorOrder,
    openEditInternalDoorOrder,
    openInternalDoorDetails,
    closeInternalDoorDetails,
    handleRushToggle,
    handleBastionSalesChangesUpdate,
    handleBastionProductionPriorityUpdate,
    handleBastionLabelToggle,
    handleRestoreOrder,
    handleCancelOrderClick,
    openEditOrderModal,
    handleDuplicateOrder,
    handleRequestCloseOrderModal,
    handleOpenReviewOrder,
    handleMarkVerified,
    handleCancelReviewOrder,
    openOrderFromWarehouseMovement,
    handleShowOrderHistory,
    handleGlassReceived,
    confirmProductionStageRevert,
    confirmReleaseClear,
  } = useOrders({
    pushToast,
    touchSession,
    activeTab,
    isManager,
    currentUser,
    companies,
    allConfigDefaults,
    bastionFrameOptions,
    dimensionMap,
    glassAllowances,
    extensionProfileWidths,
    consumeStockForOrderWithToasts,
    syncWarehouseStockAfterOrderEdit,
    fetchOrdersNeedingReview,
    setOrdersNeedingReview,
    fetchWarehouseStock,
    fetchSmartRop,
    setShowCompanyDropdown,
    setHighlightedIndex,
    highlightedIndex,
    setDeleteConfirm,
    setActiveTab,
    setActiveSubTab,
  })

  // Update refs so useWarehouse can call fetchOrders and setOrders from useOrders
  fetchOrdersRef.current = fetchOrders
  setOrdersRef.current = setOrders
  setAlertsBadgeCountRef.current = setAlertsBadgeCount

  // Pracownik produkcji (nowa rola) oznacza TYLKO przypisane mu etapy — także w tabelach.
  // Legacy 'worker' bez zmian (okres przejściowy).
  const myAssignedStageKeys = useMemo(
    () => new Set(workerStagesForCurrent.map((w) => w.stage_key)),
    [workerStagesForCurrent],
  )
  const guardedMarkProductionStage = useCallback(
    (orderId: number, stageKey: string) => {
      if (currentUser?.role === 'pracownik_produkcji' && !myAssignedStageKeys.has(stageKey)) {
        pushToast('Możesz oznaczać tylko przypisane Ci etapy', 'error')
        return
      }
      return markProductionStageWithProfileInitials(orderId, stageKey)
    },
    [currentUser?.role, myAssignedStageKeys, markProductionStageWithProfileInitials, pushToast],
  )
  const guardedSetStageRevertTarget = useCallback(
    (target: Parameters<typeof setStageRevertTarget>[0]) => {
      if (
        currentUser?.role === 'pracownik_produkcji' &&
        target &&
        !myAssignedStageKeys.has((target as { stageKey: string }).stageKey)
      ) {
        pushToast('Możesz cofać tylko przypisane Ci etapy', 'error')
        return
      }
      setStageRevertTarget(target)
    },
    [currentUser?.role, myAssignedStageKeys, setStageRevertTarget, pushToast],
  )

  const {
    activeStatsSubTab,
    setActiveStatsSubTab,
    statsOrders,
    statsComplaints,
    statsLoading,
    statsInternalDoorItemsLoading,
    fetchStatsData,
  } = useStats({ pushToast, touchSession, fetchInternalDoorItemsForVisibleOrders })

  const {
    orderCommentsCounts,
    commentsPanelState,
    fetchOrderCommentsCounts,
    handleOpenCommentsPanel,
    handleCloseCommentsPanel,
    handleCommentsCountChange,
  } = useOrderComments({ orders })

  const {
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
  } = useComplaints({
    pushToast,
    touchSession,
    activeTab,
    orders,
    archivedOrders,
    currentUser,
    setDeleteConfirm,
    setActiveTab,
    setActiveSubTab,
  })

  const {
    shippingOrders,
    shippingOrdersLoading,
    shippingCompaniesMap,
    shippingDetailsModal,
    setShippingDetailsModal,
    fetchShippingOrders,
    handleToggleReadyToInvoice,
    handleShippingRushToggle,
    handleOpenShippingOrder,
  } = useShipping({
    pushToast,
    touchSession,
    fetchInternalDoorItemsForVisibleOrders,
    setOrders,
    setInternalDoorDetailsModal,
    handleRushToggle,
    isActive: activeTab === 'Wysyłka' && isManager,
  })

  const {
    filteredApiKeys,
    loading: apiKeysLoading,
    filter: apiKeysFilter,
    setFilter: setApiKeysFilter,
    generateModal,
    setGenerateModal,
    deactivatingId: apiKeyDeactivatingId,
    fetchApiKeys,
    handleGenerateKey,
    handleSetActive: handleApiKeySetActive,
    openGenerateModal,
    closeGenerateModal,
  } = useApiKeys({ pushToast, touchSession })

  // Update the logout reset function reference after all hooks are set up
  resetAppStateAfterLogoutRef.current = () => {
    setOrders([])
    setLinkedComplaints([])
    setCompanies([])
    setIsModalOpen(false)
    setIsContractorModalOpen(false)
    setIsConfigOptionModalOpen(false)
    setDeleteConfirm(null)
    setStageRevertTarget(null)
    setReleaseClearTarget(null)
    setEditingOrderId(null)
    setEditingOrderBaseline(null)
    setActiveTab('STA')
    setUserModalOpen(false)
    setEditingProfileId(null)
    setUserForm(INITIAL_USER_FORM)
    setProfilesList([])
    setRushUpdatingOrderId(null)
    // Wyczyść filtry/wyszukiwanie — współdzielone komputery w hali
    setSearchTerm('')
    setSelectedProductionDay('Wszystkie dni')
    setHideCompletedOrders(true)
    setShowCancelledOrders(false)
    setSourceFilter('all')
    setWykonawcaFilter([])
    setActiveSubTab('Zamówienia')
    setGlobalSearchOpen(false)
  }

  const handleStaDistingSheetNavigate = useCallback((sheetValue: string, e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const v = sheetValue.trim()
    if (!v) return
    setActiveTab('Disting')
    setSearchTerm(v)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDistingStaSheetNavigate = useCallback((sheetValue: string, e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const v = sheetValue.trim()
    if (!v) return
    setActiveTab('STA')
    setSearchTerm(v)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleStTitanStaSheetNavigate = useCallback((sheetValue: string, e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const v = sheetValue.trim()
    if (!v) return
    setActiveTab('STA')
    setSearchTerm(v)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!authSession) return
    void fetchProfiles()
  }, [authSession, fetchProfiles])

  // Globalna wyszukiwarka — skrót Ctrl/Cmd + K
  useEffect(() => {
    if (!authSession) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setGlobalSearchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [authSession])

  // Utwórz nowego kontrahenta z nazwy z zamówienia (np. BOT bez dopasowania)
  const handleCreateCompanyFromName = useCallback(async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const { error } = await supabase
      .from('companies')
      .insert([{ name: trimmed, city: '', route_day: '', production_day: '' }])
    if (error) {
      pushToast(`Błąd tworzenia kontrahenta: ${error.message}`, 'error')
      return
    }
    pushToast(`Utworzono kontrahenta: ${trimmed}`, 'success')
    await fetchCompanies()
  }, [pushToast, fetchCompanies])

  // Zapamiętaj ręczne dopasowanie nazwy kontrahenta (konfigurator → baza)
  const handleSaveCompanyAlias = useCallback(async (aliasName: string, companyName: string) => {
    const alias = aliasName.trim().toLowerCase()
    if (!alias || !companyName.trim()) return
    const { error } = await supabase
      .from('company_aliases')
      .upsert(
        { alias_name: alias, company_name: companyName, created_by: currentUser?.id ?? null },
        { onConflict: 'alias_name' },
      )
    if (error) {
      // tabela może nie istnieć jeszcze — nie blokuj zapisu zamówienia
      console.warn('[company_aliases]', error.message)
    }
  }, [currentUser?.id])

  const handleGlobalSearchNavigate = useCallback((order: SearchResult) => {
    const cat = order.category
    if ((TABS as readonly string[]).includes(cat)) {
      setActiveTab(cat as (typeof TABS)[number])
      setActiveSubTab('Zamówienia')
      setSearchTerm(order.order_number)
      setShowCancelledOrders(true)
      setHideCompletedOrders(false)
    }
  }, [setActiveTab, setActiveSubTab, setSearchTerm, setShowCancelledOrders, setHideCompletedOrders])

  useEffect(() => {
    if (!authSession) return
    setActiveSubTab('Zamówienia') // reset podzakładki przy zmianie kategorii
    setActiveConfigSubTab('Słowniki')
    if (activeTab === 'Kontrahenci') {
      setOrders([])
      setComplaints([])
      void fetchCompanies()
      return
    }
    if (activeTab === 'Konfiguracja') {
      setOrders([])
      setComplaints([])
      return
    }
    if (activeTab === 'Użytkownicy') {
      setOrders([])
      setComplaints([])
      void fetchProfiles()
      return
    }
    if (activeTab === 'Magazyn') {
      setOrders([])
      setComplaints([])
      setActiveWarehouseSubTab('Stany')
      return
    }
    if (activeTab === 'Statystyki') {
      setOrders([])
      setComplaints([])
      void fetchStatsData()
      return
    }
    if (activeTab === 'Audyt') {
      setOrders([])
      setComplaints([])
      return
    }
    if (activeTab === 'Archiwum') {
      setOrders([])
      setComplaints([])
      return
    }
    if (activeTab === 'Wysyłka') {
      setOrders([])
      setComplaints([])
      return
    }
    if (activeTab === 'Zamawianie' || activeTab === 'Inwentaryzacja' || activeTab === 'Pulpit') {
      setOrders([])
      setComplaints([])
      return
    }
    fetchOrders()
    void fetchComplaints()
    void fetchExclusions()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authSession,
    activeTab,
    fetchOrders,
    fetchComplaints,
    fetchCompanies,
    fetchProfiles,
    fetchExclusions,
    fetchStatsData,
  ])

  useEffect(() => {
    if (!authSession) return
    if (
      [
        'Kontrahenci',
        'Konfiguracja',
        'Użytkownicy',
        'Magazyn',
        'Statystyki',
        'Audyt',
        'Archiwum',
        'Wysyłka',
      ].includes(activeTab)
    )
      return

    // Subskrypcja na zmiany w orders
    const ordersChannel = supabase
      .channel(`orders:${activeTab}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `category=eq.${activeTab}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setOrders((prev) => {
              if (prev.some((o) => o.id === (payload.new as Order).id)) return prev
              return [payload.new as Order, ...prev]
            })
          }
          if (payload.eventType === 'UPDATE') {
            const incoming = payload.new as Order
            setOrders((prev) =>
              prev.map((o) => {
                if (o.id !== incoming.id) return o
                // Merge production_stages: nigdy nie nadpisuj lokalnie wypełnionego etapu
                // pustą wartością z realtime (race condition z optimistic update)
                const localStages = (o.production_stages ?? {}) as Record<string, string>
                const remoteStages = (incoming.production_stages ?? {}) as Record<string, string>
                const merged: Record<string, string> = { ...remoteStages }
                for (const [k, v] of Object.entries(localStages)) {
                  if (v?.trim() && !merged[k]?.trim()) merged[k] = v
                }
                return { ...incoming, production_stages: merged }
              }),
            )
          }
          if (payload.eventType === 'DELETE') {
            setOrders((prev) =>
              prev.filter((o) => o.id !== (payload.old as { id: number }).id),
            )
          }
        },
      )
      .subscribe()

    // Subskrypcja na zmiany w complaints
    const complaintsChannel = supabase
      .channel(`complaints:${activeTab}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'complaints',
          filter: `category=eq.${activeTab}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setComplaints((prev) => {
              if (prev.some((c) => c.id === (payload.new as Complaint).id)) return prev
              return [payload.new as Complaint, ...prev]
            })
          }
          if (payload.eventType === 'UPDATE') {
            setComplaints((prev) =>
              prev.map((c) =>
                c.id === (payload.new as Complaint).id
                  ? (payload.new as Complaint)
                  : c,
              ),
            )
          }
          if (payload.eventType === 'DELETE') {
            setComplaints((prev) =>
              prev.filter((c) => c.id !== (payload.old as { id: number }).id),
            )
          }
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(ordersChannel)
      void supabase.removeChannel(complaintsChannel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authSession, activeTab])

  useEffect(() => {
    if (!authSession || activeTab !== 'Konfiguracja') return
    void fetchConfigOptionsList()
    void fetchExclusions()
    void fetchConfigOptionsForExclusions()
    void fetchLeadTimeRules()
  }, [authSession, activeTab, fetchConfigOptionsList, fetchExclusions, fetchConfigOptionsForExclusions, fetchLeadTimeRules])

  useEffect(() => {
    if (!authSession) return
    void fetchSuppliers()
  }, [authSession, fetchSuppliers])

  useEffect(() => {
    if (!authSession) return
    void fetchCompanySettings()
  }, [authSession, fetchCompanySettings])

  useEffect(() => {
    if (!authSession || activeTab !== 'Konfiguracja' || activeConfigSubTab !== 'Dostawcy') return
    void fetchSuppliers()
  }, [authSession, activeTab, activeConfigSubTab, fetchSuppliers])

  useEffect(() => {
    if (!authSession) return
    void fetchInternalDoorConfigOptions()
  }, [authSession, fetchInternalDoorConfigOptions])

  useEffect(() => {
    setActiveExclusionCategory(exclusionForm.category)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exclusionForm.category])

  useEffect(() => {
    if (!authSession) return
    fetchCompanies()
  }, [authSession, fetchCompanies])

  useEffect(() => {
    if (
      !authSession ||
      !isModalOpen ||
      (activeTab !== 'STA' &&
        activeTab !== 'Disting' &&
        activeTab !== 'ST' &&
        activeTab !== 'Techniczne' &&
        activeTab !== 'Bastion')
    ) {
      return
    }
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase
        .from('config_options')
        .select('type, value, sort_order')
        .eq('category', activeTab)
        .order('sort_order', { ascending: true })
        .order('value', { ascending: true })
      if (cancelled) return
      if (error) {
        console.error(error)
        setOrderModalConfigRows([])
        return
      }
      setOrderModalConfigRows((data || []) as StaConfigRow[])
    })()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authSession, isModalOpen, activeTab])

  const orderModalOptionsByType = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const row of orderModalConfigRows) {
      if (!m[row.type]) m[row.type] = []
      m[row.type].push(row.value)
    }
    return m
  }, [orderModalConfigRows])

  const recipeModalOptionsByType = useMemo(() => {
    const category = recipeFormData.category
    return configOptions[category] ?? {}
  }, [configOptions, recipeFormData.category])

  useEffect(() => {
    if (!authSession || !recipeEditorOpen) return
    void fetchConfigOptionsForExclusions()
  }, [authSession, recipeEditorOpen, fetchConfigOptionsForExclusions])

  // Prefetch słownika konfiguracji po zalogowaniu — żeby receptury/wykluczenia
  // miały dane od razu (bez pustych dropdownów przy pierwszym otwarciu modala).
  useEffect(() => {
    if (!authSession) return
    void fetchConfigOptionsForExclusions()
  }, [authSession, fetchConfigOptionsForExclusions])

  // Tabela kontrahentów
  const contractorsTableRows = useMemo(() => {
    const query = contractorSearchTerm.trim().toLowerCase()
    const rows = !query
      ? companies
      : companies.filter((company) => (company.name || '').toLowerCase().includes(query))
    return rows
  }, [companies, contractorSearchTerm])

  useEffect(() => {
    if (!topLightDimsFilled) {
      setStaFormData((p) => ({ ...p, top_light_glazing: '' }))
    }
  }, [topLightDimsFilled, setStaFormData])

  useEffect(() => {
    if (!sidePanelAFilled) {
      setStaFormData((p) => ({ ...p, side_panel_a_glazing: '' }))
    }
  }, [sidePanelAFilled, setStaFormData])

  useEffect(() => {
    if (!sidePanelBFilled) {
      setStaFormData((p) => ({ ...p, side_panel_b_glazing: '' }))
    }
  }, [sidePanelBFilled, setStaFormData])

  useEffect(() => {
    if (autoTopLightWidth && isModalOpen) {
      setStaFormData((p) => ({ ...p, top_light_w_mm: autoTopLightWidth }))
    }
  }, [autoTopLightWidth, isModalOpen, setStaFormData])

  useEffect(() => {
    if (autoSidePanelHeight && isModalOpen) {
      setStaFormData((p) => ({ ...p, side_panel_h_mm: autoSidePanelHeight }))
    }
  }, [autoSidePanelHeight, isModalOpen, setStaFormData])

  const categoryFilteredOrders = useMemo(() => {
    if (
      activeTab === 'Kontrahenci' ||
      activeTab === 'Konfiguracja' ||
      activeTab === 'Użytkownicy' ||
      activeTab === 'Magazyn' ||
      activeTab === 'Statystyki' ||
      activeTab === 'Weryfikacja' ||
      activeTab === 'Audyt' ||
      activeTab === 'Archiwum' ||
      activeTab === 'Wysyłka' ||
      activeTab === 'Etykiety' ||
      activeTab === 'Pomoc' ||
      activeTab === 'Zgłoszenia'
    ) {
      return []
    }
    const query = searchTerm.trim().toLowerCase()
    const filterByDay = selectedProductionDay !== 'Wszystkie dni'
    const activeCategory = activeTab.toLowerCase()

    return orders.filter((order) => {
      const matchCategory = order.category.toLowerCase() === activeCategory
      const matchQuery =
        String(order.order_number ?? '')
          .toLowerCase()
          .includes(query) ||
        String(order.disting_sheet ?? '')
          .toLowerCase()
          .includes(query) ||
        String(order.sta_sheet ?? '')
          .toLowerCase()
          .includes(query) ||
        String(order.sta_ref ?? '')
          .toLowerCase()
          .includes(query) ||
        String(order.company ?? '')
          .toLowerCase()
          .includes(query) ||
        String(order.system ?? '')
          .toLowerCase()
          .includes(query) ||
        String(order.model ?? '')
          .toLowerCase()
          .includes(query) ||
        String(order.wing_color ?? '')
          .toLowerCase()
          .includes(query)

      const matchDay = !filterByDay || order.production_day === selectedProductionDay
      const matchNotReleased =
        !hideCompletedOrders || isReleaseDateEmpty(order.release_date)
      const isCancelled =
        typeof order.extra_fields === 'object' &&
        order.extra_fields !== null &&
        (order.extra_fields as Record<string, unknown>).cancelled === true
      const matchNotCancelled = showCancelledOrders || !isCancelled
      return matchCategory && matchQuery && matchDay && matchNotReleased && matchNotCancelled
    })
  }, [activeTab, orders, searchTerm, selectedProductionDay, hideCompletedOrders, showCancelledOrders])

  const filteredOrders = useMemo(() => {
    return categoryFilteredOrders.filter((order) => {
      if (sourceFilter !== 'all') {
        if (sourceFilter === 'manual' && order.source === 'bot') return false
        if (sourceFilter === 'bot' && order.source !== 'bot') return false
      }
      if (wykonawcaFilter.length > 0) {
        const wyk = (order.extra_fields as Record<string, unknown> | null)?.wykonawca as string | undefined
        if (!wyk || !wykonawcaFilter.includes(wyk)) return false
      }
      return true
    })
  }, [categoryFilteredOrders, sourceFilter, wykonawcaFilter])

  const sourceFilterCounts = useMemo(
    () => ({
      all: categoryFilteredOrders.length,
      manual: categoryFilteredOrders.filter((o) => o.source !== 'bot').length,
      bot: categoryFilteredOrders.filter((o) => o.source === 'bot').length,
    }),
    [categoryFilteredOrders],
  )

  const bastionBatchOrders = useMemo(() => {
    return filteredOrders.filter((order) => {
      const frameType = String((order as Record<string, unknown>).bastion_frame_type ?? '').trim()
      if (!frameType) return false
      const frameOption = bastionFrameOptions.find((o) => o.value === frameType)
      return !!frameOption?.add_to_batch
    })
  }, [filteredOrders, bastionFrameOptions])

  const filteredComplaints = useMemo(() => {
    return complaints.filter((c) => {
      const isCancelled =
        typeof c.extra_fields === 'object' &&
        c.extra_fields !== null &&
        (c.extra_fields as Record<string, unknown>).cancelled === true
      return showCancelledOrders || !isCancelled
    })
  }, [complaints, showCancelledOrders])

  const ordersForComplaintSelect = useMemo(() => {
    type Opt = {
      id: number | null
      order_number: string
      company: string
      category: string
      isArchived: boolean
      sortKey: string
    }

    const active: Opt[] = orders.map((o) => ({
      id: o.id ?? null,
      order_number: o.order_number ?? '',
      company: o.company ?? '',
      category: o.category ?? '',
      isArchived: false,
      sortKey: (o as { created_at?: string }).created_at ?? o.order_date ?? '',
    }))

    const archived: Opt[] = archivedOrdersForComplaints.map((a) => ({
      id: null,
      order_number: a.order_number ?? '',
      company: a.company ?? '',
      category: a.category ?? '',
      isArchived: true,
      sortKey: a.created_at ?? '',
    }))

    // Scal i sortuj po numerze zlecenia (numerycznie malejąco)
    const combined = [...active, ...archived]
    combined.sort((x, y) => {
      const xNum = parseInt(x.order_number, 10)
      const yNum = parseInt(y.order_number, 10)
      if (!isNaN(xNum) && !isNaN(yNum)) {
        return yNum - xNum
      }
      return y.order_number.localeCompare(x.order_number)
    })
    return combined
  }, [orders, archivedOrdersForComplaints])

  const newOrderFormNumber = useMemo(() => {
    if (activeTab === 'STA' || activeTab === 'Disting') return staFormData.order_number
    if (activeTab === 'ST') return stFormData.order_number
    if (activeTab === 'Techniczne') return techniczneFormData.order_number
    if (activeTab === 'Bastion') return bastionFormData.order_number
    return formData.order_number
  }, [
    activeTab,
    staFormData.order_number,
    stFormData.order_number,
    techniczneFormData.order_number,
    bastionFormData.order_number,
    formData.order_number,
  ])

  const stOrdersStageLayout = useMemo(() => {
    if (activeTab !== 'ST') return null
    const stRows = orders.filter((o) => o.category === 'ST')
    const tit = stRows.filter(isStTitanOrder)
    if (stRows.length === 0) return { mode: 'std' as const, defs: ST_STAGE_DEFS }
    if (tit.length === stRows.length) return { mode: 'titan' as const, defs: ST_TITAN_STAGE_DEFS }
    if (tit.length === 0) return { mode: 'std' as const, defs: ST_STAGE_DEFS }
    return { mode: 'mixed' as const, defs: ST_MIXED_STAGE_DEFS }
  }, [activeTab, orders])

  const orderStageColumnDefs = useMemo(() => {
    if (activeTab === 'ST') return stOrdersStageLayout?.defs ?? ST_STAGE_DEFS
    return getTableStageDefinitions(activeTab)
  }, [activeTab, stOrdersStageLayout])

  const isCompaniesTab = activeTab === 'Kontrahenci'
  const isConfigTab = activeTab === 'Konfiguracja'
  const isUsersTab = activeTab === 'Użytkownicy'
  const isApiKeysTab = activeTab === 'Klucze API'
  const isStatsTab = activeTab === 'Statystyki'
  const isReviewTab = activeTab === 'Weryfikacja'
  const isAuditTab = activeTab === 'Audyt'
  const isArchiveTab = activeTab === 'Archiwum'
  const isShippingTab = activeTab === 'Wysyłka'
  const isMyStationTab = activeTab === 'Moje stanowisko'
  const isZamawianiTab = activeTab === 'Zamawianie'
  const isInwentaryzacjaTab = activeTab === 'Inwentaryzacja'
  const isLabelsTab = activeTab === 'Etykiety'
  const isHelpTab = activeTab === 'Pomoc'
  const isFeedbackTab = activeTab === 'Zgłoszenia'
  const [printLabelOrder, setPrintLabelOrder] = useState<Order | null>(null)
  const isPulpitTab = activeTab === 'Pulpit'

  const handleDeleteWarehouseComponent = useCallback(
    async (id: number) => {
      touchSession()
      const { error } = await supabase
        .from('warehouse_components')
        .update({ is_active: false })
        .eq('id', id)
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }

      // Usuń stany magazynowe dla tego komponentu
      // (ruchy zostają — audyt historii)
      const { error: stockError } = await supabase.from('warehouse_stock').delete().eq('component_id', id)

      if (stockError) {
        pushToast(`Komponent usunięty, ale nie udało się wyczyścić stanów: ${stockError.message}`, 'error')
      } else {
        pushToast('Komponent usunięty', 'success')
      }

      await fetchWarehouseComponents()
      // Odśwież też widok stanów jeśli jest otwarty
      if (isWarehouseDataTab) {
        await fetchWarehouseStock()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pushToast, fetchWarehouseComponents, fetchWarehouseStock, isWarehouseDataTab],
  )

  const usesStructuredOrderForm =
    activeTab === 'STA' ||
    activeTab === 'Disting' ||
    activeTab === 'ST' ||
    activeTab === 'Techniczne' ||
    activeTab === 'Bastion'

  const ordersTableWrapperRef = useRef<HTMLDivElement>(null)
  const glassTableWrapperRef = useRef<HTMLDivElement>(null)

  const syncOrdersStickyCol1Width = useCallback(() => {
    const root = ordersTableWrapperRef.current
    if (!root) return
    const th = root.querySelector<HTMLElement>('thead th.col-order-number')
    if (!th) return
    const w = th.offsetWidth
    if (w > 0) {
      root.style.setProperty('--orders-sticky-col1-width', `${w}px`)
    }
  }, [])

  const syncGlassStickyCol1Width = useCallback(() => {
    const root = glassTableWrapperRef.current
    if (!root) return
    const th = root.querySelector<HTMLElement>('thead th.col-order-number')
    if (!th) return
    const w = th.offsetWidth
    if (w > 0) {
      root.style.setProperty('--orders-sticky-col1-width', `${w}px`)
    }
  }, [])

  useLayoutEffect(() => {
    if (
      isCompaniesTab ||
      isConfigTab ||
      isUsersTab ||
      isApiKeysTab ||
      isWarehouseTab ||
      isStatsTab ||
      isReviewTab ||
      isAuditTab ||
      isArchiveTab ||
      isMyStationTab ||
      isShippingTab ||
      isZamawianiTab ||
      isInwentaryzacjaTab ||
      isPulpitTab ||
      loading
    )
      return
    syncOrdersStickyCol1Width()
    if (activeSubTab === 'Naświetla') {
      syncGlassStickyCol1Width()
    }
  }, [
    isCompaniesTab,
    isConfigTab,
    isUsersTab,
    isApiKeysTab,
    isWarehouseTab,
    isStatsTab,
    isReviewTab,
    isAuditTab,
    isArchiveTab,
    isMyStationTab,
    isShippingTab,
    loading,
    syncOrdersStickyCol1Width,
    filteredOrders,
    activeTab,
    activeSubTab,
    syncGlassStickyCol1Width,
  ])

  useEffect(() => {
    if (
      isCompaniesTab ||
      isConfigTab ||
      isUsersTab ||
      isApiKeysTab ||
      isWarehouseTab ||
      isStatsTab ||
      isReviewTab ||
      isAuditTab ||
      isArchiveTab ||
      isMyStationTab ||
      isShippingTab ||
      isZamawianiTab ||
      isInwentaryzacjaTab ||
      isPulpitTab ||
      loading
    )
      return
    const root = ordersTableWrapperRef.current
    const th = root?.querySelector('thead th.col-order-number') ?? null
    const ro = th
      ? new ResizeObserver(() => {
          syncOrdersStickyCol1Width()
        })
      : null
    if (ro && th) {
      ro.observe(th)
      window.addEventListener('resize', syncOrdersStickyCol1Width)
    }

    const glassRoot = glassTableWrapperRef.current
    const glassTh =
      activeSubTab === 'Naświetla'
        ? (glassRoot?.querySelector('thead th.col-order-number') ?? null)
        : null
    const glassRo = glassTh
      ? new ResizeObserver(() => {
          syncGlassStickyCol1Width()
        })
      : null
    if (glassRo && glassTh) {
      glassRo.observe(glassTh)
      window.addEventListener('resize', syncGlassStickyCol1Width)
    }

    return () => {
      if (ro) {
        ro.disconnect()
        window.removeEventListener('resize', syncOrdersStickyCol1Width)
      }
      if (glassRo) {
        glassRo.disconnect()
        window.removeEventListener('resize', syncGlassStickyCol1Width)
      }
    }
  }, [
    isCompaniesTab,
    isConfigTab,
    isUsersTab,
    isWarehouseTab,
    isStatsTab,
    isReviewTab,
    isAuditTab,
    isArchiveTab,
    isMyStationTab,
    isShippingTab,
    isApiKeysTab,
    loading,
    syncOrdersStickyCol1Width,
    syncGlassStickyCol1Width,
    activeTab,
    filteredOrders,
    activeSubTab,
  ])

  const visibleTabs = useMemo(() => {
    if (!currentUser) return [] as (typeof TABS)[number][]
    return tabsForUserDepartment(currentUser.department, isManager, currentUser.role, currentUser.categories)
  }, [currentUser, isManager])

  useEffect(() => {
    if (!currentUser) return
    if (visibleTabs.length > 0 && !visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0])
    }
  }, [activeTab, currentUser, visibleTabs])

  useEffect(() => {
    if (!currentUser) return
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0]!)
    }
  }, [currentUser, visibleTabs, activeTab])

  useEffect(() => {
    if (!currentUser) {
      didSetDefaultTabRef.current = false
      return
    }
    if (didSetDefaultTabRef.current) return
    if (isManagerRole(currentUser.role)) {
      setActiveTab('Pulpit')
      didSetDefaultTabRef.current = true
      return
    }
    if (currentUser.role !== 'worker') {
      didSetDefaultTabRef.current = true
      return
    }

    void (async () => {
      const { data, error } = await supabase
        .from('worker_stages')
        .select('id')
        .eq('worker_id', currentUser.id)
        .limit(1)

      if (error) {
        console.error('Failed to check worker_stages:', error)
      } else if ((data?.length ?? 0) > 0) {
        setActiveTab('Moje stanowisko')
      }
      didSetDefaultTabRef.current = true
    })()
  }, [currentUser])

  useEffect(() => {
    if (activeTab === 'Moje stanowisko') {
      void fetchMyWorkerStages()
      void fetchMyStationOrders()
    }
  }, [activeTab, fetchMyWorkerStages, fetchMyStationOrders])

  // Pracownik produkcji potrzebuje swoich przypisanych etapów wszędzie (gating w tabelach),
  // nie tylko na „Moje stanowisko".
  useEffect(() => {
    if (currentUser?.role === 'pracownik_produkcji') void fetchMyWorkerStages()
  }, [currentUser?.id, currentUser?.role, fetchMyWorkerStages])

  useEffect(() => {
    const ids = orders.map((o) => o.id).filter((x): x is number => x !== undefined)
    void fetchOrderCommentsCounts(ids)
  }, [orders, fetchOrderCommentsCounts])

  useEffect(() => {
    if (activeTab === 'Audyt' && isManager) {
      void fetchAuditLog(auditFilters)
    }
  }, [activeTab, isManager, fetchAuditLog, auditFilters])

  useEffect(() => {
    if (activeTab === 'Archiwum' && isManager) {
      void fetchArchivedOrders()
    }
  }, [activeTab, isManager, fetchArchivedOrders])

  useEffect(() => {
    if (!authSession || !isManager) {
      setOrdersNeedingReview([])
      return
    }
    void fetchOrdersNeedingReview()
    const interval = setInterval(() => {
      void fetchOrdersNeedingReview()
    }, 60_000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authSession, isManager, fetchOrdersNeedingReview])

  useEffect(() => {
    if (activeTab === 'Wysyłka' && isManager) {
      void fetchShippingOrders()
    }
  }, [activeTab, isManager, fetchShippingOrders])

  useEffect(() => {
    if (!showComplaintForm) return

    void (async () => {
      touchSession()
      const { data } = await supabase
        .from('orders_archive')
        .select('id, order_number, company, category, created_at, archived_at')
        .eq('category', activeTab)
        .order('created_at', { ascending: false })
        .limit(500)

      setArchivedOrdersForComplaints((data ?? []) as ArchivedOrder[])
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showComplaintForm, activeTab, touchSession])

  useEffect(() => {
    if (!isWarehouseDataTab) return
    void fetchWarehouseComponents()
  }, [isWarehouseDataTab, fetchWarehouseComponents])

  useEffect(() => {
    if (isWarehouseDataTab) {
      void fetchWarehouses()
    }
  }, [isWarehouseDataTab, fetchWarehouses])

  useEffect(() => {
    if (isWarehouseDataTab) {
      void fetchWarehouseStock()
    }
  }, [isWarehouseDataTab, fetchWarehouseStock])

  useEffect(() => {
    if (isWarehouseDataTab) {
      void fetchSmartRop()
    }
  }, [isWarehouseDataTab, fetchSmartRop])

  useEffect(() => {
    if (isWarehouseTab) {
      void fetchPurchaseOrders()
    }
  }, [isWarehouseTab, fetchPurchaseOrders])

  useEffect(() => {
    if (isWarehouseTab && activeWarehouseSubTab === 'Receptury') {
      void fetchWarehouseRecipes()
    }
  }, [isWarehouseTab, activeWarehouseSubTab, fetchWarehouseRecipes, showDeletedRecipes])

  useEffect(() => {
    if (isWarehouseTab) {
      void fetchWarehouseMovements()
    }
  }, [isWarehouseTab, fetchWarehouseMovements])

  useEffect(() => {
    if (isWarehouseTab && activeWarehouseSubTab === 'Przyjęcia') {
      void fetchPzGroups()
    }
  }, [isWarehouseTab, activeWarehouseSubTab, fetchPzGroups])

  useEffect(() => {
    if (isWarehouseTab && activeWarehouseSubTab === 'Przesunięcia') {
      void fetchMmGroups()
    }
  }, [isWarehouseTab, activeWarehouseSubTab, fetchMmGroups])

  useEffect(() => {
    if (isWarehouseTab && activeWarehouseSubTab === 'Miesięczne zużycie') {
      void fetchMonthlyConsumption(monthlyConsumptionRange)
    }
  }, [isWarehouseTab, activeWarehouseSubTab, monthlyConsumptionRange, fetchMonthlyConsumption])

  useEffect(() => {
    if (isWarehouseTab && activeWarehouseSubTab === 'Prognozy') {
      void fetchWarehouseComponents()
    }
  }, [isWarehouseTab, activeWarehouseSubTab, fetchWarehouseComponents])

  useEffect(() => {
    if (!canSeeReorderTab && activeWarehouseSubTab === 'Zamawianie') {
      setActiveWarehouseSubTab('Stany')
    }
  }, [canSeeReorderTab, activeWarehouseSubTab])

  useEffect(() => {
    if (!canSeePurchaseOrdersTab && activeWarehouseSubTab === 'Zamówienia') {
      setActiveWarehouseSubTab('Stany')
    }
  }, [canSeePurchaseOrdersTab, activeWarehouseSubTab])

  useEffect(() => {
    if (!isManager) {
      setAlertsBadgeCount(0)
      return
    }
    void fetchAlertsBadgeCount()
    const interval = setInterval(() => void fetchAlertsBadgeCount(), 5 * 60 * 1000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, fetchAlertsBadgeCount])

  useEffect(() => {
    if (isManager && activeTab === 'Magazyn') {
      void fetchAlertsBadgeCount()
    }
  }, [isManager, activeTab, fetchAlertsBadgeCount])

  const configDictionariesForCategory = useMemo(
    () => CONFIG_DICTIONARIES.filter((d) => d.category === selectedConfigCategory),
    [selectedConfigCategory],
  )

  const availableCodes = (
    configOptions[dimensionMapForm.category]?.['rozmiar'] ?? []
  ).filter(
    (code) =>
      !dimensionMap.some(
        (d) => d.category === dimensionMapForm.category && d.dimension_code === code,
      ),
  )

  const getOptionsForField = (category: string, field: string): string[] => {
    const optionType = EXCLUSION_FIELD_TO_OPTION_TYPE[field]
    if (!optionType) return []
    return configOptions[category]?.[optionType] ?? []
  }

  const availableSourceValues = exclusionForm.source_field
    ? getOptionsForField(exclusionForm.category, exclusionForm.source_field)
    : []
  const filteredExclusions = useMemo(
    () => exclusions.filter((ex) => ex.category === activeExclusionCategory),
    [exclusions, activeExclusionCategory],
  )
  const searchedExclusions = exclusionSearch.trim()
    ? filteredExclusions.filter((ex) => {
        const q = exclusionSearch.toLowerCase()
        return (
          ex.source_value.toLowerCase().includes(q) ||
          ex.target_value.toLowerCase().includes(q) ||
          (EXCLUSION_FIELD_LABELS[ex.source_field] ?? ex.source_field).toLowerCase().includes(q) ||
          (EXCLUSION_FIELD_LABELS[ex.target_field] ?? ex.target_field).toLowerCase().includes(q)
        )
      })
    : filteredExclusions
  const groupedFilteredExclusions = useMemo(
    () =>
      Object.entries(
        Object.fromEntries(
          Object.entries(
            searchedExclusions.reduce(
              (acc, ex) => {
                const key = `${ex.source_field}:${ex.source_value}`
                if (!acc[key]) acc[key] = []
                acc[key].push(ex)
                return acc
              },
              {} as Record<string, ConfigExclusion[]>,
            ),
          ).map(([key, items]) => [
            key,
            [...items].sort((a, b) => {
              const fieldCmp = a.target_field.localeCompare(b.target_field)
              if (fieldCmp !== 0) return fieldCmp
              return a.target_value.localeCompare(b.target_value)
            }),
          ]),
        ),
      ),
    [searchedExclusions],
  )

  const staExclusionFormData = useMemo(
    () => ({ ...staFormData, electric_strike: staFormData.zaczep }),
    [staFormData],
  )
  const availableProfiles = useMemo(
    () =>
      extensionProfileWidths
        .filter((p) => p.category === activeTab)
        .map((p) => p.profile_width_mm)
        .sort((a, b) => a - b),
    [extensionProfileWidths, activeTab],
  )
  const stExclusionFormData = useMemo(() => ({ ...stFormData }), [stFormData])
  const techniczneExclusionFormData = useMemo(() => ({ ...techniczneFormData }), [techniczneFormData])
  const bastionExclusionFormData = useMemo(
    () => ({
      ...bastionFormData,
      decorative_panel: bastionFormData.frame_type,
    }),
    [bastionFormData],
  )
  const legacyExclusionFormData = useMemo(() => ({ ...formData }), [formData])

  const openAddConfigOption = () => {
    const maxOrder = configOptionsList.reduce((m, r) => Math.max(m, r.sort_order), -1)
    setEditingConfigOption(null)
    setConfigOptionForm({ value: '', sort_order: maxOrder + 1 })
    setConfigAddStep('value')
    setPendingRozmiarValue('')
    setDimensionModalForm({ width_mm: 0, height_mm: 0 })
    setIsConfigOptionModalOpen(true)
  }

  const openEditConfigOption = (row: ConfigOptionRecord) => {
    setEditingConfigOption(row)
    setConfigOptionForm({ value: row.value, sort_order: row.sort_order })
    setConfigAddStep('value')
    setPendingRozmiarValue('')
    setDimensionModalForm({ width_mm: 0, height_mm: 0 })
    setIsConfigOptionModalOpen(true)
  }

  if (!authReady) {
    return (
      <>
        <UpdateBlocker />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <div className="auth-boot-screen" role="status">
          <Spinner center label="Ładowanie…" />
        </div>
      </>
    )
  }

  if (!authSession) {
    return (
      <>
        <UpdateBlocker />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <LoginScreen
          username={loginUsername}
          password={loginPassword}
          submitting={loginSubmitting}
          onUsernameChange={setLoginUsername}
          onPasswordChange={setLoginPassword}
          onSubmit={handleLoginSubmit}
        />
      </>
    )
  }

  if (currentUser === null) {
    return (
      <>
        <UpdateBlocker />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <div className="auth-boot-screen" role="status">
          <Spinner center label="Ładowanie profilu…" />
        </div>
      </>
    )
  }

  const overdueCount = isManager
    ? orders.filter((o) => getOrderAgeStatus(o, leadTimeRules) === 'overdue').length
    : 0
  const warningCount = isManager
    ? orders.filter((o) => getOrderAgeStatus(o, leadTimeRules) === 'warning').length
    : 0

  return (
    <>
      <UpdateBlocker />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {globalLoading && <GlobalSpinner />}
      {deleteConfirm && (
        <DeleteConfirmDialog
          message={deleteConfirm.message}
          title={deleteConfirm.title}
          confirmLabel={deleteConfirm.confirmLabel}
          cancelLabel={deleteConfirm.cancelLabel}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => {
            const run = deleteConfirm.runDelete
            setDeleteConfirm(null)
            void run()
          }}
        />
      )}
      {cancelComplaintConfirm && (
        <DeleteConfirmDialog
          message={cancelComplaintConfirm.message}
          title={cancelComplaintConfirm.title}
          confirmLabel={cancelComplaintConfirm.confirmLabel}
          cancelLabel={cancelComplaintConfirm.cancelLabel}
          onCancel={() => setCancelComplaintConfirm(null)}
          onConfirm={() => {
            const run = cancelComplaintConfirm.runDelete
            setCancelComplaintConfirm(null)
            void run()
          }}
        />
      )}
      {stageRevertTarget && (
        <StageRevertPopup
          onCancel={() => setStageRevertTarget(null)}
          onConfirm={() => void confirmProductionStageRevert()}
        />
      )}
      {releaseClearTarget && (
        <ReleaseClearPopup
          onCancel={() => setReleaseClearTarget(null)}
          onConfirm={() => void confirmReleaseClear()}
        />
      )}
      <SessionWarningModal
        open={sessionWarningOpen}
        onExtend={handleExtendSession}
        onLogout={() => void handleAutoLogout()}
      />
      <GlobalSearch
        open={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        onNavigate={handleGlobalSearchNavigate}
      />
      <OrderHistoryModal
        open={historyModal.open}
        orderId={historyModal.orderId}
        orderNumber={historyModal.orderNumber}
        onClose={() => setHistoryModal({ open: false, orderId: null, orderNumber: null })}
      />
      <ShippingDetailsModal
        open={shippingDetailsModal.open}
        order={shippingDetailsModal.order}
        companyInfo={
          shippingDetailsModal.order
            ? shippingCompaniesMap.get((shippingDetailsModal.order.company ?? '').trim().toLowerCase()) ?? null
            : null
        }
        glassAllowances={glassAllowances}
        currentUserId={currentUser?.id ?? ''}
        currentUserInitials={currentUser?.initials ?? ''}
        pushToast={pushToast}
        onClose={() => setShippingDetailsModal({ open: false, order: null })}
      />
      <WorkerStagesModal
        open={workerStagesModal.open}
        worker={workerStagesModal.worker}
        onClose={() => setWorkerStagesModal({ open: false, worker: null })}
        onSaved={() => {
          pushToast('Etapy zaktualizowane', 'success')
        }}
      />
      <OrderCommentsPanel
        open={commentsPanelState.open}
        orderId={commentsPanelState.orderId}
        orderNumber={commentsPanelState.orderNumber}
        orderCategory={commentsPanelState.orderCategory}
        currentUserId={currentUser?.id ?? ''}
        currentUserRole={currentUser?.role ?? ''}
        profiles={profilesList.map((p) => ({ id: p.id, full_name: p.full_name ?? '' }))}
        onClose={handleCloseCommentsPanel}
        onCountChange={handleCommentsCountChange}
      />
      <InternalDoorOrderModal
        open={internalDoorOrderModal.open}
        mode={internalDoorOrderModal.mode}
        initialOrder={internalDoorOrderModal.order}
        initialItems={
          internalDoorOrderModal.order
            ? internalDoorItems.filter((it) => it.order_id === internalDoorOrderModal.order?.id)
            : []
        }
        components={warehouseComponents}
        companies={companies.map((c) => c.name).filter((name) => Boolean(name))}
        currentUserId={currentUser?.id ?? ''}
        pushToast={pushToast}
        onClose={() => setInternalDoorOrderModal((prev) => ({ ...prev, open: false }))}
        onSaved={async () => {
          await fetchOrders()
          await fetchWarehouseStock()
          await fetchWarehouseMovements()
          pushToast('Zamówienie zapisane', 'success')
        }}
      />
      {internalDoorDetailsModal.open && internalDoorDetailsModal.order && (
        <InternalDoorOrderDetailsModal
          open={internalDoorDetailsModal.open}
          order={internalDoorDetailsModal.order}
          items={internalDoorItems.filter((it) => it.order_id === internalDoorDetailsModal.order!.id)}
          currentUser={{
            role: isManagerRole(currentUser?.role)
              ? 'manager'
              : currentUser?.role === 'sprzedawca' || currentUser?.role === 'obsluga_klienta'
                ? 'sprzedawca'
                : 'worker',
            department: currentUser?.department ?? 'all',
            id: currentUser?.id ?? '',
            initials: currentUser?.initials ?? '',
          }}
          onClose={closeInternalDoorDetails}
          onEdit={(order) => {
            closeInternalDoorDetails()
            openEditInternalDoorOrder(order)
          }}
          onAfterAction={async () => {
            await fetchOrders()
            await fetchWarehouseStock()
            await fetchWarehouseMovements()
            await fetchShippingOrders()
          }}
          pushToast={pushToast}
        />
      )}
    <div className="app-layout">
      <Sidebar
        visibleTabs={visibleTabs}
        activeTab={activeTab}
        onChange={(tab) => setActiveTab(tab as (typeof TABS)[number])}
        reviewCount={ordersNeedingReview.length}
        warehouseAlertsCount={alertsBadgeCount}
        overdueCount={overdueCount + warningCount}
      />
      <div className="app-content">
        <AppHeader
          activeTab={activeTab}
          isCompaniesTab={isCompaniesTab}
          isConfigTab={isConfigTab}
          isUsersTab={isUsersTab}
          isWarehouseTab={isWarehouseTab}
          isStatsTab={isStatsTab}
          isReviewTab={isReviewTab}
          isAuditTab={isAuditTab}
          isArchiveTab={isArchiveTab}
          isMyStationTab={isMyStationTab}
          isShippingTab={isShippingTab}
          isApiKeysTab={isApiKeysTab}
          currentUserFullName={currentUser?.full_name ?? ''}
          currentUserId={currentUser?.id ?? ''}
          onNavigateTab={(tab) => setActiveTab(tab as (typeof TABS)[number])}
          onAddContractor={openAddContractorModal}
          onAddUser={openAddUserModal}
          onNewOrder={activeTab === 'DrzwiWewnetrzne' ? openCreateInternalDoorOrder : openNewOrderModal}
          onSignOut={() => void handleSignOut()}
        />
        <UpdateBanner />
        <OverdueBanner
          overdueCount={overdueCount}
          warningCount={warningCount}
          onNavigateToShipping={() => setActiveTab('Wysyłka')}
        />
        <main className="app-main">

        {!isCompaniesTab &&
          !isConfigTab &&
          !isUsersTab &&
          !isWarehouseTab &&
          !isStatsTab &&
          !isReviewTab &&
          !isAuditTab &&
          !isArchiveTab &&
          !isMyStationTab &&
          !isShippingTab &&
          !isZamawianiTab &&
          !isInwentaryzacjaTab &&
          !isLabelsTab &&
          !isHelpTab &&
          !isFeedbackTab &&
          !isPulpitTab &&
          isModalOpen && (
          <OrderFormModal
            {...{
              activeTab,
              usesStructuredOrderForm,
              onRequestClose: handleRequestCloseOrderModal,
              onPrintLabel: (o: Order) => setPrintLabelOrder(o),
              editingOrderId,
              editingOrderBaseline,
              newOrderFormNumber,
              submitOnEnterInInput,
              handleSaveOrder,
              staFormData,
              orderFormErrors,
              setHighlightedIndex,
              setOrderFormErrors,
              handleStaFormChange,
              showCompanyDropdown,
              setShowCompanyDropdown,
              filteredStaCompanies,
              handleCompanyAutocompleteKeyDown,
              handleStaCompanySelect,
              highlightedIndex,
              orderModalOptionsByType,
              isFieldValueExcluded,
              exclusions,
              staExclusionFormData,
              topLightDimsFilled,
              availableProfiles,
              calcExtensionDims,
              dimensionMap,
              isExtSideActive,
              getExtQty,
              setExtQty,
              stFormData,
              isStTitanSystemLabel,
              filteredStCompanies,
              handleStCompanySelect,
              handleStFormChange,
              stExclusionFormData,
              techniczneFormData,
              filteredTechniczneCompanies,
              handleTechniczneCompanySelect,
              handleTechniczneFormChange,
              techniczneExclusionFormData,
              bastionFormData,
              bastionFrameOptions,
              filteredBastionCompanies,
              handleBastionCompanySelect,
              handleBastionFormChange,
              bastionExclusionFormData,
              filteredCompanies,
              handleCompanySelect,
              formData,
              handleFormChange,
              legacyExclusionFormData,
              isSaving,
              allCompanies: companies,
              onSaveCompanyAlias: handleSaveCompanyAlias,
              onCreateCompany: handleCreateCompanyFromName,
              onDuplicate: editingOrderBaseline
                ? () => void handleDuplicateOrder(editingOrderBaseline)
                : undefined,
            }}
          />
        )}

        {printLabelOrder && (
          <PrintLabelModal
            order={printLabelOrder}
            onClose={() => setPrintLabelOrder(null)}
            pushToast={pushToast}
          />
        )}

        {!isFeedbackTab && (
          <FeedbackFab currentUser={currentUser} page={activeTab} pushToast={pushToast} />
        )}

        {recipeEditorOpen && (
          <RecipeEditorModal
            open={recipeEditorOpen}
            mode={recipeEditorMode}
            formData={recipeFormData}
            warehouseComponents={warehouseComponents}
            orderModalOptionsByType={recipeModalOptionsByType}
            onChange={handleRecipeFormChange}
            onComponentChange={handleRecipeComponentChange}
            onAddComponent={handleAddRecipeComponent}
            onRemoveComponent={handleRemoveRecipeComponent}
            onSave={handleSaveRecipe}
            onClose={() => setRecipeEditorOpen(false)}
            saving={recipeSaving}
          />
        )}

        <SupplierFormModal
          open={supplierModal.open}
          mode={supplierModal.mode}
          initialSupplier={supplierModal.supplier}
          onClose={closeSupplierModal}
          onSaved={() => {
            void fetchSuppliers()
          }}
          pushToast={pushToast}
        />

        <ShoppingListModal
          open={shoppingListModalOpen}
          shoppingList={shoppingList}
          suppliers={suppliers}
          components={warehouseComponents}
          stock={warehouseStock}
          onClose={() => setShoppingListModalOpen(false)}
          onRemove={handleRemoveFromShoppingList}
          onUpdateQuantity={handleUpdateShoppingListQuantity}
          onAddToShoppingList={handleAddToShoppingList}
          onClear={handleClearShoppingList}
          onGenerated={() => {
            void fetchPurchaseOrders()
          }}
          pushToast={pushToast}
        />

        <PurchaseOrderDetailsModal
          open={poDetailsModal.open}
          purchaseOrder={poDetailsModal.po}
          items={purchaseOrderItems.filter((it) => it.purchase_order_id === poDetailsModal.po?.id)}
          suppliers={suppliers}
          components={warehouseComponents}
          companySettings={companySettings}
          warehouses={warehouses}
          isManager={isManager}
          currentUser={currentUser}
          profiles={profilesList}
          onClose={closePoDetails}
          onAfterAction={() => {
            void onPoAfterAction()
          }}
          onOpenReceive={openPoReceive}
          pushToast={pushToast}
        />

        <PurchaseOrderReceiveModal
          open={poReceiveModal.open}
          purchaseOrder={poReceiveModal.po}
          items={purchaseOrderItems.filter(
            (it) =>
              it.purchase_order_id === poReceiveModal.po?.id &&
              (it.status_per_item === 'pending' || it.status_per_item === 'partial'),
          )}
          components={warehouseComponents}
          warehouses={warehouses}
          onClose={closePoReceive}
          onSaved={() => {
            void onPoAfterAction()
          }}
          pushToast={pushToast}
        />

        <FinishedDoorComponentFormModal
          open={doorComponentModal.open}
          mode={doorComponentModal.mode}
          initialComponent={doorComponentModal.component}
          onClose={() => setDoorComponentModal((prev) => ({ ...prev, open: false }))}
          onSaved={() => {
            void fetchWarehouseComponents()
            pushToast('Pozycja zapisana', 'success')
          }}
          configOptions={internalDoorConfigOptions}
          suppliers={suppliers}
        />

        {componentHistoryModal.open && componentHistoryModal.component && (
          <ComponentHistoryModal
            open={componentHistoryModal.open}
            component={componentHistoryModal.component}
            stockRows={warehouseStock.filter((s) => s.component_id === componentHistoryModal.component!.id)}
            movements={warehouseMovements.filter((m) => m.component_id === componentHistoryModal.component!.id)}
            onClose={closeComponentHistory}
            onOpenOrder={openOrderFromWarehouseMovement}
          />
        )}

        {pzFormOpen && (
          <PzFormModal
            open={pzFormOpen}
            mode="create"
            formData={pzFormData}
            warehouses={warehouses}
            components={warehouseComponents}
            suppliers={suppliers}
            onChange={handlePzFormChange}
            onItemChange={handlePzItemChange}
            onAddItem={handleAddPzItem}
            onRemoveItem={handleRemovePzItem}
            onSave={handleSavePz}
            onClose={() => setPzFormOpen(false)}
            saving={pzSaving}
          />
        )}

        {mmFormOpen && (
          <MmFormModal
            open={mmFormOpen}
            mode="create"
            formData={mmFormData}
            warehouses={warehouses}
            components={warehouseComponents}
            onChange={handleMmFormChange}
            onItemChange={handleMmItemChange}
            onAddItem={handleAddMmItem}
            onRemoveItem={handleRemoveMmItem}
            onSave={handleSaveMm}
            onClose={() => setMmFormOpen(false)}
            saving={mmSaving}
          />
        )}

        {docDetailsModal.open && (
          <DocumentDetailsModal
            open={docDetailsModal.open}
            referenceDoc={docDetailsModal.referenceDoc}
            movementType={docDetailsModal.movementType}
            onClose={handleCloseDocDetails}
          />
        )}

        {isCompaniesTab && (
          <ContractorModal
            open={isContractorModalOpen}
            editingCompany={editingCompany}
            contractorFormData={contractorFormData}
            isContractorSaving={isContractorSaving}
            onClose={() => setIsContractorModalOpen(false)}
            onChange={handleContractorFormChange}
            onSave={() => void handleSaveContractor()}
            submitOnEnterInInput={submitOnEnterInInput}
          />
        )}

        <ConfigOptionModal
          open={isConfigOptionModalOpen}
          editingConfigOption={editingConfigOption}
          configOptionForm={configOptionForm}
          configAddStep={configAddStep}
          selectedConfigDictType={selectedConfigDictType}
          pendingRozmiarValue={pendingRozmiarValue}
          dimensionModalForm={dimensionModalForm}
          isConfigOptionSaving={isConfigOptionSaving}
          onClose={() => {
            setIsConfigOptionModalOpen(false)
            setConfigAddStep('value')
            setPendingRozmiarValue('')
            setDimensionModalForm({ width_mm: 0, height_mm: 0 })
          }}
          onFormChange={(patch) => setConfigOptionForm((p) => ({ ...p, ...patch }))}
          onDimensionModalFormChange={(patch) => setDimensionModalForm((p) => ({ ...p, ...patch }))}
          onSave={() => void handleSaveConfigOption()}
          onSaveRozmiar={() => void handleSaveRozmiarWithDimensions()}
          onBackToValue={() => {
            setConfigAddStep('value')
            setPendingRozmiarValue('')
            setDimensionModalForm({ width_mm: 0, height_mm: 0 })
          }}
          submitOnEnterInInput={submitOnEnterInInput}
        />

        {isUsersTab && (
          <UserModal
            open={userModalOpen}
            userModalMode={userModalMode}
            userForm={userForm}
            userModalSaving={userModalSaving}
            onClose={closeUserModal}
            onFormChange={(patch) => setUserForm((p) => ({ ...p, ...patch }))}
            onSave={() => void handleSaveUser()}
            submitOnEnterInInput={submitOnEnterInInput}
          />
        )}

        <ComplaintFormModal
          open={showComplaintForm}
          complaintFormData={complaintFormData}
          complaintFormLoading={complaintFormLoading}
          orders={orders}
          archivedOrdersForComplaints={archivedOrdersForComplaints}
          ordersForComplaintSelect={ordersForComplaintSelect}
          onClose={() => {
            setShowComplaintForm(false)
            setComplaintFormData(INITIAL_COMPLAINT_FORM_DATA)
          }}
          onFormChange={(patch) => setComplaintFormData((p) => ({ ...p, ...patch }))}
          onSelectOrder={searchOrdersForComplaint}
          onSelectArchived={(orderNumber, company) =>
            setComplaintFormData((p) => ({
              ...p,
              order_id: null,
              order_number: orderNumber,
              company,
            }))
          }
          onSave={() => void handleSaveComplaint()}
          submitOnEnterInInput={submitOnEnterInInput}
        />

        {isPulpitTab ? (
          <DashboardView
            currentUserFullName={currentUser?.full_name ?? ''}
            reviewCount={ordersNeedingReview.length}
            alertsBadgeCount={alertsBadgeCount}
            onNavigate={(tab) => setActiveTab(tab as (typeof TABS)[number])}
          />
        ) : isCompaniesTab ? (
          <>
            <div className="orders-filters">
              <input
                type="text"
                className="search-input"
                placeholder="Wyszukaj kontrahenta po nazwie..."
                value={contractorSearchTerm}
                onChange={(event) => setContractorSearchTerm(event.target.value)}
              />
            </div>
            <CompaniesView
              companiesLoading={companiesLoading}
              companies={contractorsTableRows}
              isManager={isManager}
              onEditCompany={handleEditCompany}
              onDeleteCompany={handleDeleteContractor}
            />
          </>
        ) : isConfigTab && isManager ? (
          <ConfigView
            activeConfigSubTab={activeConfigSubTab}
            setActiveConfigSubTab={setActiveConfigSubTab}
            isManager={isManager}
            selectedConfigCategory={selectedConfigCategory}
            setSelectedConfigCategory={setSelectedConfigCategory}
            selectedConfigDictKey={selectedConfigDictKey}
            setSelectedConfigDictKey={setSelectedConfigDictKey}
            configDictionariesForCategory={configDictionariesForCategory}
            selectedConfigDict={selectedConfigDict}
            openAddConfigOption={openAddConfigOption}
            configOptionsLoading={configOptionsLoading}
            configOptionsList={configOptionsList}
            draggedItemId={draggedItemId}
            setDraggedItemId={setDraggedItemId}
            dragOverItemId={dragOverItemId}
            setDragOverItemId={setDragOverItemId}
            handleReorderConfigOptions={handleReorderConfigOptions}
            openEditConfigOption={openEditConfigOption}
            handleDeleteConfigOption={handleDeleteConfigOption}
            onToggleDefault={handleToggleConfigOptionDefault}
            onUpdateLabelMultiplier={handleUpdateLabelMultiplier}
            onUpdateAddToBatch={handleUpdateAddToBatch}
            exclusionForm={exclusionForm}
            setExclusionForm={setExclusionForm}
            exclusionSourceFilter={exclusionSourceFilter}
            setExclusionSourceFilter={setExclusionSourceFilter}
            availableSourceValues={availableSourceValues}
            getOptionsForField={getOptionsForField}
            handleSaveExclusion={handleSaveExclusion}
            activeExclusionCategory={activeExclusionCategory}
            setActiveExclusionCategory={setActiveExclusionCategory}
            exclusions={exclusions}
            exclusionSearch={exclusionSearch}
            setExclusionSearch={setExclusionSearch}
            searchedExclusions={searchedExclusions}
            groupedFilteredExclusions={groupedFilteredExclusions}
            handleDeleteExclusionGroup={handleDeleteExclusionGroup}
            handleDeleteExclusion={handleDeleteExclusion}
            dimensionMapForm={dimensionMapForm}
            setDimensionMapForm={setDimensionMapForm}
            availableCodes={availableCodes}
            handleSaveDimensionMap={handleSaveDimensionMap}
            dimensionMap={dimensionMap}
            handleDeleteDimensionMap={handleDeleteDimensionMap}
            extensionProfileForm={extensionProfileForm}
            setExtensionProfileForm={setExtensionProfileForm}
            handleSaveExtensionProfile={handleSaveExtensionProfile}
            extensionProfileWidths={extensionProfileWidths}
            handleUpdateExtensionProfileWidth={handleUpdateExtensionProfileWidth}
            handleDeleteExtensionProfile={handleDeleteExtensionProfile}
            glassAllowances={glassAllowances}
            handleUpdateGlassAllowance={handleUpdateGlassAllowance}
            suppliers={suppliers}
            suppliersLoading={suppliersLoading}
            onCreateSupplier={openCreateSupplier}
            onEditSupplier={openEditSupplier}
            onToggleSupplierActive={toggleSupplierActive}
            companySettings={companySettings}
            companySettingsLoading={companySettingsLoading}
            onCompanySettingsSaved={() => {
              void fetchCompanySettings()
            }}
            leadTimeRules={leadTimeRules}
            fetchLeadTimeRules={fetchLeadTimeRules}
            onSaveLeadTimeRule={handleSaveLeadTimeRule}
            onDeleteLeadTimeRule={handleDeleteLeadTimeRule}
            onToggleLeadTimeRuleActive={handleToggleLeadTimeRuleActive}
            pushToast={pushToast}
          />
        ) : isUsersTab && isManager ? (
          <UsersView
            profilesLoading={profilesLoading}
            profiles={profilesList}
            currentUserId={currentUser?.id}
            onEditUser={openEditUserModal}
            onDeleteUser={handleDeleteUserClick}
            onManageWorkerStages={(profile) => setWorkerStagesModal({ open: true, worker: profile })}
            getRoleLabel={profileRoleLabel}
            getDepartmentLabel={profileDepartmentLabel}
          />
        ) : isApiKeysTab && isManager ? (
          <ApiKeysView
            apiKeys={filteredApiKeys}
            filteredApiKeys={filteredApiKeys}
            loading={apiKeysLoading}
            filter={apiKeysFilter}
            setFilter={setApiKeysFilter}
            generateModal={generateModal}
            setGenerateModal={setGenerateModal}
            deactivatingId={apiKeyDeactivatingId}
            onRefresh={() => void fetchApiKeys()}
            onGenerateKey={() => void handleGenerateKey()}
            onSetActive={handleApiKeySetActive}
            openGenerateModal={openGenerateModal}
            closeGenerateModal={closeGenerateModal}
          />
        ) : isStatsTab && isManager ? (
          <StatsView
            orders={statsOrders}
            complaints={statsComplaints}
            internalDoorItems={internalDoorItems}
            loading={statsLoading}
            internalDoorItemsLoading={statsInternalDoorItemsLoading}
            activeSubTab={activeStatsSubTab}
            onSubTabChange={setActiveStatsSubTab}
          />
        ) : isReviewTab && isManager ? (
          <OrdersNeedingReviewView
            orders={ordersNeedingReview}
            loading={reviewLoading}
            onEdit={handleOpenReviewOrder}
            onMarkVerified={handleMarkVerified}
            onCancel={handleCancelReviewOrder}
          />
        ) : isAuditTab && isManager ? (
          <AuditLogView
            rows={auditLog}
            loading={auditLoading}
            onRefresh={() => void fetchAuditLog(auditFilters)}
            onFilterChange={setAuditFilters}
          />
        ) : isArchiveTab && isManager ? (
          <ArchiveView
            orders={archivedOrders}
            loading={archivedOrdersLoading}
            runLogs={archiveRunLogs}
            onRefresh={() => void fetchArchivedOrders()}
            onCreateComplaint={handleCreateComplaintFromArchive}
          />
        ) : isMyStationTab ? (
          <MyStationView
            currentUserId={currentUser?.id ?? ''}
            orders={myStationOrders}
            workerStages={workerStagesForCurrent}
            onStageComplete={handleStageComplete}
            loading={myStationLoading}
          />
        ) : isShippingTab && isManager ? (
          <ShippingView
            orders={shippingOrders}
            companiesMap={shippingCompaniesMap}
            loading={shippingOrdersLoading}
            onRefresh={() => void fetchShippingOrders()}
            onShowDetails={handleOpenShippingOrder}
            onToggleReadyToInvoice={handleToggleReadyToInvoice}
            onRushToggle={handleShippingRushToggle}
            rushUpdatingOrderId={rushUpdatingOrderId}
            isManager={isManager}
            glassAllowances={glassAllowances}
            leadTimeRules={leadTimeRules}
          />
        ) : isZamawianiTab ? (
          <WarehouseView
            isManager={isManager}
            activeSubTab="Zamawianie"
            onSubTabChange={() => {}}
            hideSubTabs
            warehouses={warehouses}
            stock={warehouseStock}
            stockLoading={warehouseStockLoading}
            components={warehouseComponents}
            componentsLoading={warehouseComponentsLoading}
            onCreateComponent={handleCreateWarehouseComponent}
            onUpdateComponent={handleUpdateWarehouseComponent}
            onSetComponentWarehouses={handleSetComponentWarehouses}
            onCleanupStock={handleCleanupOrphanStock}
            onDeleteComponent={handleDeleteWarehouseComponent}
            onAddDoorComponent={openAddDoorComponent}
            onEditDoorComponent={openEditDoorComponent}
            onShowHistory={openComponentHistory}
            editRequestComponent={warehouseEditRequestComponent}
            onEditRequestHandled={() => setWarehouseEditRequestComponent(null)}
            recipes={warehouseRecipes}
            recipesLoading={warehouseRecipesLoading}
            onCreateRecipe={handleOpenRecipeEditor}
            onEditRecipe={handleEditRecipe}
            onDeleteRecipe={handleDeleteRecipe}
            onToggleRecipeActive={handleToggleRecipeActive}
            showDeleted={showDeletedRecipes}
            onToggleShowDeleted={setShowDeletedRecipes}
            onRestore={handleRestoreRecipe}
            movements={warehouseMovements}
            movementsLoading={warehouseMovementsLoading}
            pzGroups={pzGroups}
            pzGroupsLoading={pzGroupsLoading}
            onPzCreate={handleOpenPzForm}
            onPzPreview={handlePzPreview}
            mmGroups={mmGroups}
            mmGroupsLoading={mmGroupsLoading}
            onMmCreate={handleOpenMmForm}
            onMmPreview={handleMmPreview}
            monthlyConsumption={monthlyConsumption}
            monthlyConsumptionMonths={monthlyConsumptionMonths}
            monthlyConsumptionLoading={monthlyConsumptionLoading}
            monthlyConsumptionRange={monthlyConsumptionRange}
            onMonthlyConsumptionRefresh={() => void fetchMonthlyConsumption(monthlyConsumptionRange)}
            onMonthlyConsumptionRangeChange={setMonthlyConsumptionRange}
            alertsBadgeCount={alertsBadgeCount}
            suppliers={suppliers}
            canSeeReorderTab={canSeeReorderTab}
            canSeePurchaseOrdersTab={canSeePurchaseOrdersTab}
            shoppingList={shoppingList}
            smartRopData={smartRopData}
            smartRopLoading={smartRopLoading}
            onAddToShoppingList={handleAddToShoppingList}
            onOpenShoppingList={() => setShoppingListModalOpen(true)}
            onEditComponent={openComponentEditFromDashboard}
            purchaseOrders={purchaseOrders}
            purchaseOrderItems={purchaseOrderItems}
            purchaseOrdersLoading={purchaseOrdersLoading}
            companySettings={companySettings}
            currentUser={currentUser}
            onShowPurchaseOrderDetails={openPoDetails}
            pushToast={pushToast}
          />
        ) : isInwentaryzacjaTab ? (
          <WarehouseView
            isManager={isManager}
            activeSubTab="Inwentaryzacja"
            onSubTabChange={() => {}}
            hideSubTabs
            warehouses={warehouses}
            stock={warehouseStock}
            stockLoading={warehouseStockLoading}
            components={warehouseComponents}
            componentsLoading={warehouseComponentsLoading}
            onCreateComponent={handleCreateWarehouseComponent}
            onUpdateComponent={handleUpdateWarehouseComponent}
            onSetComponentWarehouses={handleSetComponentWarehouses}
            onCleanupStock={handleCleanupOrphanStock}
            onDeleteComponent={handleDeleteWarehouseComponent}
            onAddDoorComponent={openAddDoorComponent}
            onEditDoorComponent={openEditDoorComponent}
            onShowHistory={openComponentHistory}
            editRequestComponent={warehouseEditRequestComponent}
            onEditRequestHandled={() => setWarehouseEditRequestComponent(null)}
            recipes={warehouseRecipes}
            recipesLoading={warehouseRecipesLoading}
            onCreateRecipe={handleOpenRecipeEditor}
            onEditRecipe={handleEditRecipe}
            onDeleteRecipe={handleDeleteRecipe}
            onToggleRecipeActive={handleToggleRecipeActive}
            showDeleted={showDeletedRecipes}
            onToggleShowDeleted={setShowDeletedRecipes}
            onRestore={handleRestoreRecipe}
            movements={warehouseMovements}
            movementsLoading={warehouseMovementsLoading}
            pzGroups={pzGroups}
            pzGroupsLoading={pzGroupsLoading}
            onPzCreate={handleOpenPzForm}
            onPzPreview={handlePzPreview}
            mmGroups={mmGroups}
            mmGroupsLoading={mmGroupsLoading}
            onMmCreate={handleOpenMmForm}
            onMmPreview={handleMmPreview}
            monthlyConsumption={monthlyConsumption}
            monthlyConsumptionMonths={monthlyConsumptionMonths}
            monthlyConsumptionLoading={monthlyConsumptionLoading}
            monthlyConsumptionRange={monthlyConsumptionRange}
            onMonthlyConsumptionRefresh={() => void fetchMonthlyConsumption(monthlyConsumptionRange)}
            onMonthlyConsumptionRangeChange={setMonthlyConsumptionRange}
            alertsBadgeCount={alertsBadgeCount}
            suppliers={suppliers}
            canSeeReorderTab={canSeeReorderTab}
            canSeePurchaseOrdersTab={canSeePurchaseOrdersTab}
            shoppingList={shoppingList}
            smartRopData={smartRopData}
            smartRopLoading={smartRopLoading}
            onAddToShoppingList={handleAddToShoppingList}
            onOpenShoppingList={() => setShoppingListModalOpen(true)}
            onEditComponent={openComponentEditFromDashboard}
            purchaseOrders={purchaseOrders}
            purchaseOrderItems={purchaseOrderItems}
            purchaseOrdersLoading={purchaseOrdersLoading}
            companySettings={companySettings}
            currentUser={currentUser}
            onShowPurchaseOrderDetails={openPoDetails}
            pushToast={pushToast}
          />
        ) : isLabelsTab ? (
          <LabelsView
            isManager={isManager}
            currentUser={currentUser}
            pushToast={pushToast}
          />
        ) : isHelpTab ? (
          <HelpView />
        ) : isFeedbackTab ? (
          <FeedbackView isManager={isManager} currentUser={currentUser} pushToast={pushToast} />
        ) : isWarehouseTab ? (
          <WarehouseView
            isManager={isManager}
            activeSubTab={activeWarehouseSubTab}
            onSubTabChange={setActiveWarehouseSubTab}
            warehouses={warehouses}
            stock={warehouseStock}
            stockLoading={warehouseStockLoading}
            components={warehouseComponents}
            componentsLoading={warehouseComponentsLoading}
            onCreateComponent={handleCreateWarehouseComponent}
            onUpdateComponent={handleUpdateWarehouseComponent}
            onSetComponentWarehouses={handleSetComponentWarehouses}
            onCleanupStock={handleCleanupOrphanStock}
            onDeleteComponent={handleDeleteWarehouseComponent}
            onAddDoorComponent={openAddDoorComponent}
            onEditDoorComponent={openEditDoorComponent}
            onShowHistory={openComponentHistory}
            editRequestComponent={warehouseEditRequestComponent}
            onEditRequestHandled={() => setWarehouseEditRequestComponent(null)}
            recipes={warehouseRecipes}
            recipesLoading={warehouseRecipesLoading}
            onCreateRecipe={handleOpenRecipeEditor}
            onEditRecipe={handleEditRecipe}
            onDeleteRecipe={handleDeleteRecipe}
            onToggleRecipeActive={handleToggleRecipeActive}
            showDeleted={showDeletedRecipes}
            onToggleShowDeleted={setShowDeletedRecipes}
            onRestore={handleRestoreRecipe}
            movements={warehouseMovements}
            movementsLoading={warehouseMovementsLoading}
            pzGroups={pzGroups}
            pzGroupsLoading={pzGroupsLoading}
            onPzCreate={handleOpenPzForm}
            onPzPreview={handlePzPreview}
            onAddPzFromStock={handleOpenPzForm}
            mmGroups={mmGroups}
            mmGroupsLoading={mmGroupsLoading}
            onMmCreate={handleOpenMmForm}
            onMmPreview={handleMmPreview}
            monthlyConsumption={monthlyConsumption}
            monthlyConsumptionMonths={monthlyConsumptionMonths}
            monthlyConsumptionLoading={monthlyConsumptionLoading}
            monthlyConsumptionRange={monthlyConsumptionRange}
            onMonthlyConsumptionRefresh={() => void fetchMonthlyConsumption(monthlyConsumptionRange)}
            onMonthlyConsumptionRangeChange={setMonthlyConsumptionRange}
            alertsBadgeCount={alertsBadgeCount}
            suppliers={suppliers}
            canSeeReorderTab={canSeeReorderTab}
            canSeePurchaseOrdersTab={canSeePurchaseOrdersTab}
            shoppingList={shoppingList}
            smartRopData={smartRopData}
            smartRopLoading={smartRopLoading}
            onAddToShoppingList={handleAddToShoppingList}
            onOpenShoppingList={() => setShoppingListModalOpen(true)}
            onEditComponent={openComponentEditFromDashboard}
            purchaseOrders={purchaseOrders}
            purchaseOrderItems={purchaseOrderItems}
            purchaseOrdersLoading={purchaseOrdersLoading}
            companySettings={companySettings}
            currentUser={currentUser}
            onShowPurchaseOrderDetails={openPoDetails}
            pushToast={pushToast}
          />
        ) : (
          <>
            <OrdersFilters
              searchTerm={searchTerm}
              selectedProductionDay={selectedProductionDay}
              hideCompletedOrders={hideCompletedOrders}
              showCancelledOrders={showCancelledOrders}
              sourceFilter={sourceFilter}
              sourceFilterCounts={sourceFilterCounts}
              showSourceFilter={['STA', 'Disting', 'ST', 'Techniczne', 'Bastion'].includes(activeTab)}
              wykonawcaFilter={wykonawcaFilter}
              showWykonawcaFilter={activeTab === 'STA' || activeTab === 'Disting'}
              onSearchChange={(v) => startFilterTransition(() => setSearchTerm(v))}
              onDayChange={(v) => startFilterTransition(() => setSelectedProductionDay(v))}
              onHideCompletedChange={(v) => startFilterTransition(() => setHideCompletedOrders(v))}
              onShowCancelledChange={(v) => startFilterTransition(() => setShowCancelledOrders(v))}
              onSourceFilterChange={(v) => startFilterTransition(() => setSourceFilter(v))}
              onWykonawcaFilterChange={(v) => startFilterTransition(() => setWykonawcaFilter(v))}
            />
            {!loading && orders.length > 0 && (
              <div className="orders-count-bar">
                {isFilterPending ? (
                  <span className="orders-count-bar--filtering">Filtrowanie…</span>
                ) : filteredOrders.length === orders.length
                  ? <span>Zamówień: <strong>{orders.length}</strong></span>
                  : <span>Wyświetlane: <strong>{filteredOrders.length}</strong> z <strong>{orders.length}</strong></span>
                }
              </div>
            )}
            {loading ? (
              <Spinner center label="Ładowanie zamówień…" />
            ) : (
              <div style={{ position: 'relative' }}>
                {isFilterPending && (
                  <div className="filter-overlay">
                    <div className="filter-overlay-spinner" />
                  </div>
                )}

                {['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne'].includes(activeTab) && (
                  <div className="subtab-bar">
                    <button
                      type="button"
                      className={`btn btn-sm ${activeSubTab === 'Zamówienia' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setActiveSubTab('Zamówienia')}
                    >
                      Zamówienia
                    </button>
                    {activeTab !== 'DrzwiWewnetrzne' && (
                      <button
                        type="button"
                        className={`btn btn-sm ${activeSubTab === 'Reklamacje' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setActiveSubTab('Reklamacje')}
                      >
                        Reklamacje
                      </button>
                    )}
                    {(activeTab === 'STA' || activeTab === 'Disting') && (
                      <button
                        type="button"
                        className={`btn btn-sm ${activeSubTab === 'Naświetla' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setActiveSubTab('Naświetla')}
                      >
                        Naświetla
                      </button>
                    )}
                    {activeTab === 'Bastion' && (
                      <button
                        type="button"
                        className={`btn btn-sm ${activeSubTab === 'Ościeżnice regulowane' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setActiveSubTab('Ościeżnice regulowane')}
                      >
                        Ościeżnice regulowane
                      </button>
                    )}
                  </div>
                )}
                {activeSubTab === 'Zamówienia' && (
                  <>
                {(activeTab === 'STA' || activeTab === 'Disting') && (
                  <StaDistingOrdersTableView
                    activeTab={activeTab}
                    filteredOrders={filteredOrders}
                    tableWrapperRef={ordersTableWrapperRef}
                    orderStageColumnDefs={orderStageColumnDefs}
                    isManager={isManager}
                    canSeePrices={canSeePrices}
                    productionStageUpdating={productionStageUpdating}
                    releaseDateUpdating={releaseDateUpdating}
                    rushUpdatingOrderId={rushUpdatingOrderId}
                    orders={orders}
                    linkedOrders={linkedOrders}
                    glassAllowances={glassAllowances}
                    orderCommentsCounts={orderCommentsCounts}
                    onOpenCommentsPanel={handleOpenCommentsPanel}
                    openEditOrderModal={openEditOrderModal}
                    handleRushToggle={handleRushToggle}
                    markProductionStageWithProfileInitials={guardedMarkProductionStage}
                    setStageRevertTarget={(target) => guardedSetStageRevertTarget(target)}
                    applyReleaseDateUpdate={applyReleaseDateUpdate}
                    onToggleOscReceived={toggleOscReceived}
                    setReleaseClearTarget={(target) => setReleaseClearTarget(target)}
                    handleDistingStaSheetNavigate={handleDistingStaSheetNavigate}
                    handleStaDistingSheetNavigate={handleStaDistingSheetNavigate}
                    handleCancelOrderClick={handleCancelOrderClick}
                    handleRestoreOrder={handleRestoreOrder}
                    onShowHistory={handleShowOrderHistory}
                    pushToast={pushToast}
                  />
                )}
                {activeTab === 'Bastion' && (
                  <BastionOrdersTableView
                    filteredOrders={filteredOrders}
                    linkedOrders={linkedOrders}
                    isManager={isManager}
                    canSeePrices={canSeePrices}
                    productionStageUpdating={productionStageUpdating}
                    releaseDateUpdating={releaseDateUpdating}
                    rushUpdatingOrderId={rushUpdatingOrderId}
                    glassAllowances={glassAllowances}
                    orderCommentsCounts={orderCommentsCounts}
                    onOpenCommentsPanel={handleOpenCommentsPanel}
                    tableWrapperRef={ordersTableWrapperRef}
                    openEditOrderModal={openEditOrderModal}
                    handleRushToggle={handleRushToggle}
                    markProductionStageWithProfileInitials={guardedMarkProductionStage}
                    setStageRevertTarget={(target) => guardedSetStageRevertTarget(target)}
                    applyReleaseDateUpdate={applyReleaseDateUpdate}
                    setReleaseClearTarget={(target) => setReleaseClearTarget(target)}
                    handleCancelOrderClick={handleCancelOrderClick}
                    handleRestoreOrder={handleRestoreOrder}
                    onShowHistory={handleShowOrderHistory}
                    pushToast={pushToast}
                    bastionFrameOptions={bastionFrameOptions}
                    canEditSalesChanges={canEditBastionSalesChanges(currentUser)}
                    onUpdateSalesChanges={handleBastionSalesChangesUpdate}
                    onUpdateProductionPriority={handleBastionProductionPriorityUpdate}
                    onLabelToggle={handleBastionLabelToggle}
                  />
                )}
                {activeTab === 'ST' && stOrdersStageLayout && (
                  <StOrdersTableView
                    filteredOrders={filteredOrders}
                    stOrdersStageLayout={stOrdersStageLayout}
                    tableWrapperRef={ordersTableWrapperRef}
                    isManager={isManager}
                    canSeePrices={canSeePrices}
                    releaseDateUpdating={releaseDateUpdating}
                    rushUpdatingOrderId={rushUpdatingOrderId}
                    productionStageUpdating={productionStageUpdating}
                    glassAllowances={glassAllowances}
                    orderCommentsCounts={orderCommentsCounts}
                    onOpenCommentsPanel={handleOpenCommentsPanel}
                    onOpenEditOrderModal={openEditOrderModal}
                    onHandleRushToggle={handleRushToggle}
                    onMarkProductionStageWithProfileInitials={guardedMarkProductionStage}
                    onSetStageRevertTarget={(target) => guardedSetStageRevertTarget(target)}
                    onApplyReleaseDateUpdate={applyReleaseDateUpdate}
                    onSetReleaseClearTarget={(target) => setReleaseClearTarget(target)}
                    onHandleStTitanStaSheetNavigate={handleStTitanStaSheetNavigate}
                    onHandleCancelOrderClick={handleCancelOrderClick}
                    onHandleRestoreOrder={handleRestoreOrder}
                    onShowHistory={handleShowOrderHistory}
                    pushToast={pushToast}
                  />
                )}
                {activeTab === 'Techniczne' && (
                  <TechniczneOrdersTableView
                    filteredOrders={filteredOrders}
                    tableWrapperRef={ordersTableWrapperRef}
                    isManager={isManager}
                    canSeePrices={canSeePrices}
                    releaseDateUpdating={releaseDateUpdating}
                    rushUpdatingOrderId={rushUpdatingOrderId}
                    glassAllowances={glassAllowances}
                    orderCommentsCounts={orderCommentsCounts}
                    onOpenCommentsPanel={handleOpenCommentsPanel}
                    onOpenEditOrderModal={openEditOrderModal}
                    onHandleRushToggle={handleRushToggle}
                    onApplyReleaseDateUpdate={applyReleaseDateUpdate}
                    onSetReleaseClearTarget={(target) => setReleaseClearTarget(target)}
                    onHandleCancelOrderClick={handleCancelOrderClick}
                    onHandleRestoreOrder={handleRestoreOrder}
                    onShowHistory={handleShowOrderHistory}
                    pushToast={pushToast}
                  />
                )}
                {activeTab === 'DrzwiWewnetrzne' && (
                  <InternalDoorOrdersTable
                    orders={filteredOrders}
                    items={internalDoorItems}
                    onShowDetails={openInternalDoorDetails}
                    tableWrapperRef={ordersTableWrapperRef}
                  />
                )}
                {filteredOrders.length === 0 &&
                  activeTab !== 'ST' &&
                  activeTab !== 'DrzwiWewnetrzne' &&
                  activeTab !== 'Techniczne' && (
                  <p className="no-results">Brak zamówień spełniających kryteria wyszukiwania.</p>
                )}
                  </>
                )}
                {activeSubTab === 'Reklamacje' && (
                  <ComplaintsView
                    activeTab={activeTab}
                    isManager={isManager}
                    filteredComplaints={filteredComplaints}
                    orderStageColumnDefs={orderStageColumnDefs}
                    linkedComplaints={linkedComplaints}
                    stOrdersStageLayout={stOrdersStageLayout}
                    tableWrapperRef={ordersTableWrapperRef}
                    onAddComplaint={() => setShowComplaintForm(true)}
                    onComplaintRushToggle={handleComplaintRushToggle}
                    onComplaintStageClick={handleComplaintStageClick}
                    onCancelComplaint={handleCancelComplaintClick}
                    onRestoreComplaint={handleRestoreComplaint}
                  />
                )}
                {activeSubTab === 'Naświetla' &&
                  (activeTab === 'STA' || activeTab === 'Disting') && (
                    <GlassView
                      orders={filteredOrders}
                      activeTab={activeTab}
                      glassAllowances={glassAllowances}
                      onSendGlassOrder={(order) => void sendGlassOrderWebhook(order)}
                      onGlassReceived={(orderId) => void handleGlassReceived(orderId)}
                      tableWrapperRef={glassTableWrapperRef}
                    />
                  )}
                {activeSubTab === 'Ościeżnice regulowane' && activeTab === 'Bastion' && (
                  <>
                    <BastionOrdersTableView
                      filteredOrders={bastionBatchOrders}
                      linkedOrders={linkedOrders}
                      isManager={isManager}
                      canSeePrices={canSeePrices}
                      productionStageUpdating={productionStageUpdating}
                      releaseDateUpdating={releaseDateUpdating}
                      rushUpdatingOrderId={rushUpdatingOrderId}
                      glassAllowances={glassAllowances}
                      orderCommentsCounts={orderCommentsCounts}
                      onOpenCommentsPanel={handleOpenCommentsPanel}
                      tableWrapperRef={ordersTableWrapperRef}
                      openEditOrderModal={openEditOrderModal}
                      handleRushToggle={handleRushToggle}
                      markProductionStageWithProfileInitials={guardedMarkProductionStage}
                      setStageRevertTarget={(target) => guardedSetStageRevertTarget(target)}
                      applyReleaseDateUpdate={applyReleaseDateUpdate}
                      setReleaseClearTarget={(target) => setReleaseClearTarget(target)}
                      handleCancelOrderClick={handleCancelOrderClick}
                      handleRestoreOrder={handleRestoreOrder}
                      onShowHistory={handleShowOrderHistory}
                      pushToast={pushToast}
                      bastionFrameOptions={bastionFrameOptions}
                      canEditSalesChanges={canEditBastionSalesChanges(currentUser)}
                      onUpdateSalesChanges={handleBastionSalesChangesUpdate}
                      onUpdateProductionPriority={handleBastionProductionPriorityUpdate}
                      onLabelToggle={handleBastionLabelToggle}
                    />
                    {bastionBatchOrders.length === 0 && (
                      <p className="no-results">Brak zamówień spełniających kryteria wyszukiwania.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
        </main>
      </div>
    </div>
    {/* vibe-coded easter egg — .app-easter-egg-credit */}
    <p className="app-easter-egg-credit" aria-hidden="true">
      Vibe coded high af by TW &amp; Claude 🤖
    </p>
    </>
  )
}

export default App
