import { useMemo } from 'react'
import { WAREHOUSE_SUB_TABS } from '../constants'
import type {
  CompanySettings,
  CurrentUser,
  MmGroupRow,
  MonthlyConsumptionPivot,
  PurchaseOrder,
  PurchaseOrderItem,
  PzGroupRow,
  ShoppingListItem,
  SmartRopRow,
  Supplier,
  ToastVariant,
  Warehouse,
  WarehouseComponent,
  WarehouseComponentCreateInput,
  WarehouseComponentUpdateInput,
  WarehouseMovementRow,
  WarehouseRecipe,
  WarehouseStockRow,
  WarehouseSubTab,
} from '../types'
import AlertsView from './warehouse/AlertsView'
import ComponentsView from './warehouse/ComponentsView'
import MovementsView from './warehouse/MovementsView'
import MmView from './warehouse/MmView'
import ForecastView from './warehouse/ForecastView'
import MonthlyConsumptionView from './warehouse/MonthlyConsumptionView'
import PzView from './warehouse/PzView'
import RecipesView from './warehouse/RecipesView'
import StockView from './warehouse/StockView'
import ReorderDashboardView from './warehouse/ReorderDashboardView'
import PurchaseOrdersView from './warehouse/PurchaseOrdersView'
import InventoryView from './warehouse/InventoryView'

type WarehouseViewProps = {
  isManager: boolean
  activeSubTab: WarehouseSubTab
  onSubTabChange: (tab: WarehouseSubTab) => void
  hideSubTabs?: boolean
  warehouses: Warehouse[]
  stock: WarehouseStockRow[]
  stockLoading: boolean
  components: WarehouseComponent[]
  componentsLoading: boolean
  onCreateComponent: (data: WarehouseComponentCreateInput, warehouseIds?: number[]) => Promise<void>
  onUpdateComponent: (id: number, data: WarehouseComponentUpdateInput) => Promise<void>
  onSetComponentWarehouses: (componentId: number, warehouseIds: number[]) => Promise<void>
  onCleanupStock: () => Promise<void>
  onDeleteComponent: (id: number) => Promise<void>
  onAddDoorComponent: () => void
  onEditDoorComponent: (component: WarehouseComponent) => void
  onShowHistory: (component: WarehouseComponent) => void
  editRequestComponent?: WarehouseComponent | null
  onEditRequestHandled?: () => void
  recipes: WarehouseRecipe[]
  recipesLoading: boolean
  onCreateRecipe: () => void
  onEditRecipe: (recipe: WarehouseRecipe) => void
  onDeleteRecipe: (id: number) => Promise<void>
  onToggleRecipeActive: (id: number, active: boolean) => Promise<void>
  showDeleted: boolean
  onToggleShowDeleted: (show: boolean) => void
  onRestore: (id: number) => Promise<void>
  movements: WarehouseMovementRow[]
  movementsLoading: boolean
  pzGroups: PzGroupRow[]
  pzGroupsLoading: boolean
  onPzCreate: () => void
  onPzPreview: (reference_doc: string) => void
  onAddPzFromStock?: (warehouseId?: number) => void
  mmGroups: MmGroupRow[]
  mmGroupsLoading: boolean
  onMmCreate: () => void
  onMmPreview: (reference_doc: string) => void
  monthlyConsumption: MonthlyConsumptionPivot[]
  monthlyConsumptionMonths: string[]
  monthlyConsumptionLoading: boolean
  monthlyConsumptionRange: number
  onMonthlyConsumptionRefresh: () => void
  onMonthlyConsumptionRangeChange: (months: number) => void
  alertsBadgeCount?: number
  suppliers: Supplier[]
  canSeeReorderTab: boolean
  canSeePurchaseOrdersTab: boolean
  shoppingList: ShoppingListItem[]
  smartRopData: SmartRopRow[]
  smartRopLoading: boolean
  onAddToShoppingList: (item: ShoppingListItem) => void
  onOpenShoppingList: () => void
  onEditComponent: (component: WarehouseComponent) => void
  purchaseOrders: PurchaseOrder[]
  purchaseOrderItems: PurchaseOrderItem[]
  purchaseOrdersLoading: boolean
  companySettings: CompanySettings | null
  currentUser: CurrentUser | null
  onShowPurchaseOrderDetails: (po: PurchaseOrder) => void
  pushToast: (msg: string, type: ToastVariant) => void
}

function WarehouseView({
  isManager,
  activeSubTab,
  onSubTabChange,
  hideSubTabs,
  warehouses,
  stock,
  stockLoading,
  components,
  componentsLoading,
  onCreateComponent,
  onUpdateComponent,
  onSetComponentWarehouses,
  onCleanupStock,
  onDeleteComponent,
  onAddDoorComponent,
  onEditDoorComponent,
  onShowHistory,
  editRequestComponent,
  onEditRequestHandled,
  recipes,
  recipesLoading,
  onCreateRecipe,
  onEditRecipe,
  onDeleteRecipe,
  onToggleRecipeActive,
  showDeleted,
  onToggleShowDeleted,
  onRestore,
  movements,
  movementsLoading,
  pzGroups,
  pzGroupsLoading,
  onPzCreate,
  onPzPreview,
  onAddPzFromStock,
  mmGroups,
  mmGroupsLoading,
  onMmCreate,
  onMmPreview,
  monthlyConsumption,
  monthlyConsumptionMonths,
  monthlyConsumptionLoading,
  monthlyConsumptionRange,
  onMonthlyConsumptionRefresh,
  onMonthlyConsumptionRangeChange,
  alertsBadgeCount,
  suppliers,
  canSeeReorderTab,
  canSeePurchaseOrdersTab,
  shoppingList,
  smartRopData,
  smartRopLoading,
  onAddToShoppingList,
  onOpenShoppingList,
  onEditComponent,
  purchaseOrders,
  purchaseOrderItems,
  purchaseOrdersLoading,
  companySettings,
  currentUser,
  onShowPurchaseOrderDetails,
  pushToast,
}: WarehouseViewProps) {
  const warehouseTabs = useMemo(
    () =>
      WAREHOUSE_SUB_TABS.filter(
        (t) =>
          (t !== 'Alerty' || isManager) &&
          (t !== 'Zamawianie' || canSeeReorderTab) &&
          (t !== 'Zamówienia' || canSeePurchaseOrdersTab),
      ),
    [isManager, canSeeReorderTab, canSeePurchaseOrdersTab],
  )

  return (
    <div
      className={`warehouse-view${isManager ? ' warehouse-view--manager' : ' warehouse-view--readonly'}`}
    >
      {!hideSubTabs && (
      <div className="subtab-bar" role="tablist" aria-label="Magazyn — sekcje">
        {warehouseTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeSubTab === tab}
            className={`btn btn-sm ${activeSubTab === tab ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onSubTabChange(tab)}
          >
            {tab}
            {tab === 'Alerty' && (alertsBadgeCount ?? 0) > 0 && (
              <span className="subtab-badge subtab-badge--alert">{alertsBadgeCount}</span>
            )}
          </button>
        ))}
      </div>
      )}
      {activeSubTab === 'Komponenty' ? (
        <ComponentsView
          isManager={isManager}
          components={components}
          warehouses={warehouses}
          stock={stock}
          loading={componentsLoading}
          onCreate={onCreateComponent}
          onUpdate={onUpdateComponent}
          onSetComponentWarehouses={onSetComponentWarehouses}
          onCleanupStock={onCleanupStock}
          onDelete={onDeleteComponent}
          onAddDoorComponent={onAddDoorComponent}
          onEditDoorComponent={onEditDoorComponent}
          onShowHistory={onShowHistory}
          suppliers={suppliers}
          editRequestComponent={editRequestComponent}
          onEditRequestHandled={onEditRequestHandled}
        />
      ) : activeSubTab === 'Stany' ? (
        <StockView
          warehouses={warehouses}
          components={components}
          stock={stock}
          loading={stockLoading}
          isManager={isManager}
          onAddPz={onAddPzFromStock}
          onShowHistory={onShowHistory}
        />
      ) : activeSubTab === 'Receptury' ? (
        <RecipesView
          isManager={isManager}
          recipes={recipes}
          loading={recipesLoading}
          onCreate={onCreateRecipe}
          onEdit={onEditRecipe}
          onDelete={onDeleteRecipe}
          onToggleActive={onToggleRecipeActive}
          showDeleted={showDeleted}
          onToggleShowDeleted={onToggleShowDeleted}
          onRestore={onRestore}
        />
      ) : activeSubTab === 'Ruchy' ? (
        <MovementsView
          movements={movements}
          loading={movementsLoading}
          warehouses={warehouses}
          components={components}
        />
      ) : activeSubTab === 'Przyjęcia' ? (
        <PzView
          pzGroups={pzGroups}
          loading={pzGroupsLoading}
          isManager={isManager}
          warehouses={warehouses}
          onCreate={onPzCreate}
          onPreview={onPzPreview}
        />
      ) : activeSubTab === 'Przesunięcia' ? (
        <MmView
          mmGroups={mmGroups}
          loading={mmGroupsLoading}
          isManager={isManager}
          warehouses={warehouses}
          onCreate={onMmCreate}
          onPreview={onMmPreview}
        />
      ) : activeSubTab === 'Miesięczne zużycie' ? (
        <MonthlyConsumptionView
          data={monthlyConsumption}
          months={monthlyConsumptionMonths}
          loading={monthlyConsumptionLoading}
          onRefresh={onMonthlyConsumptionRefresh}
          onRangeChange={onMonthlyConsumptionRangeChange}
          currentMonths={monthlyConsumptionRange}
        />
      ) : activeSubTab === 'Prognozy' ? (
        <ForecastView components={components} isManager={isManager} />
      ) : activeSubTab === 'Alerty' ? (
        <AlertsView isManager={isManager} />
      ) : activeSubTab === 'Zamawianie' ? (
        <ReorderDashboardView
          components={components}
          suppliers={suppliers}
          stock={stock}
          isManager={isManager}
          smartRopData={smartRopData}
          smartRopLoading={smartRopLoading}
          shoppingList={shoppingList}
          onAddToShoppingList={onAddToShoppingList}
          onOpenShoppingList={onOpenShoppingList}
          onEditComponent={onEditComponent}
        />
      ) : activeSubTab === 'Zamówienia' ? (
        <PurchaseOrdersView
          purchaseOrders={purchaseOrders}
          purchaseOrderItems={purchaseOrderItems}
          loading={purchaseOrdersLoading}
          suppliers={suppliers}
          components={components}
          companySettings={companySettings}
          warehouses={warehouses}
          isManager={isManager}
          currentUser={currentUser}
          onShowDetails={onShowPurchaseOrderDetails}
          pushToast={pushToast}
        />
      ) : activeSubTab === 'Inwentaryzacja' ? (
        <InventoryView pushToast={pushToast} currentUser={currentUser} />
      ) : (
        <p className="no-results">Widok w przygotowaniu</p>
      )}
    </div>
  )
}

export default WarehouseView
