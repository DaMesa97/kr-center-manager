import { useMemo } from 'react'
import { WAREHOUSE_SUB_TABS } from '../constants'
import { can } from '../lib/permissions'
import type {
  CompanySettings,
  CurrentUser,
  IncomingStockRow,
  MmGroupRow,
  StockLevelRow, StockMinimumInput, StockReservationRow,
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
import PzView from './warehouse/PzView'
import RecipesView from './warehouse/RecipesView'
import StockView from './warehouse/StockView'
import ReservationsView from './warehouse/ReservationsView'
import ReorderDashboardView from './warehouse/ReorderDashboardView'
import PurchaseOrdersView from './warehouse/PurchaseOrdersView'
import InventoryView from './warehouse/InventoryView'

type WarehouseViewProps = {
  isManager: boolean
  activeSubTab: WarehouseSubTab
  onSubTabChange: (tab: WarehouseSubTab) => void
  hideSubTabs?: boolean
  /** podzakładki tej pozycji menu (WAREHOUSE_TAB_SUBTABS); bez listy = wszystkie */
  subTabs?: readonly WarehouseSubTab[]
  warehouses: Warehouse[]
  stock: WarehouseStockRow[]
  stockLoading: boolean
  incomingStock?: IncomingStockRow[]
  incomingStockLoading?: boolean
  onRefreshIncoming?: () => void
  stockReservations?: StockReservationRow[]
  stockReservationsLoading?: boolean
  onRefreshReservations?: () => void
  onReleaseReservation?: (reservationId: number) => Promise<void>
  onReleaseOrderReservations?: (orderId: number) => Promise<void>
  onRefreshStock?: () => void
  /** poziomy braków per półka (v_stock_levels) — widok Stany */
  stockLevels?: StockLevelRow[]
  onSetStockMinimums?: (items: StockMinimumInput[]) => Promise<boolean>
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
  /** Ruchy: lista ucięta do ostatnich N — pokaż „Wczytaj starsze" */
  movementsTruncated?: boolean
  onLoadMoreMovements?: () => void
  onRefreshMovements?: () => void
  pzGroups: PzGroupRow[]
  pzGroupsLoading: boolean
  onPzCreate: () => void
  onPzPreview: (reference_doc: string) => void
  onAddPzFromStock?: (warehouseId?: number) => void
  mmGroups: MmGroupRow[]
  mmGroupsLoading: boolean
  onMmCreate: () => void
  onMmPreview: (reference_doc: string) => void
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
  subTabs,
  warehouses,
  stock,
  stockLoading,
  incomingStock = [],
  incomingStockLoading = false,
  onRefreshIncoming = () => {},
  stockReservations = [],
  stockLevels = [],
  onSetStockMinimums,
  stockReservationsLoading = false,
  onRefreshReservations = () => {},
  onReleaseReservation = async () => {},
  onReleaseOrderReservations,
  onRefreshStock = () => {},
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
  movementsTruncated,
  onLoadMoreMovements,
  onRefreshMovements = () => {},
  pzGroups,
  pzGroupsLoading,
  onPzCreate,
  onPzPreview,
  onAddPzFromStock,
  mmGroups,
  mmGroupsLoading,
  onMmCreate,
  onMmPreview,
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
  // PZ / MM wg permissions.ts (warehouse.movements) — magazynier też, nie tylko kierownik
  const canMovements = isManager || can(currentUser?.role, 'warehouse.movements')
  const warehouseTabs = useMemo(
    () =>
      (subTabs ?? WAREHOUSE_SUB_TABS).filter(
        (t) =>
          (t !== 'Alerty' || isManager) &&
          (t !== 'Zamawianie' || canSeeReorderTab) &&
          (t !== 'Zamówienia' || canSeePurchaseOrdersTab),
      ),
    [subTabs, isManager, canSeeReorderTab, canSeePurchaseOrdersTab],
  )

  return (
    <div
      className={`warehouse-view${isManager ? ' warehouse-view--manager' : ' warehouse-view--readonly'}`}
    >
      {!hideSubTabs && warehouseTabs.length > 1 && (
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
          smartRopData={smartRopData}
          editRequestComponent={editRequestComponent}
          onEditRequestHandled={onEditRequestHandled}
        />
      ) : activeSubTab === 'Stany' ? (
        <StockView
          warehouses={warehouses}
          components={components}
          suppliers={suppliers}
          smartRopData={smartRopData}
          levels={stockLevels}
          loading={stockLoading}
          isManager={isManager}
          canEditMin={isManager || can(currentUser?.role, 'warehouse.manage')}
          onSetMinimums={onSetStockMinimums}
          onAddToShoppingList={canSeeReorderTab ? onAddToShoppingList : undefined}
          canAddPz={canMovements}
          onAddPz={onAddPzFromStock}
          onShowHistory={onShowHistory}
          pushToast={pushToast}
          onStockChanged={onRefreshStock}
        />
      ) : activeSubTab === 'Rezerwacje' ? (
        <ReservationsView
          reservations={stockReservations}
          loading={stockReservationsLoading}
          isManager={isManager}
          onRelease={onReleaseReservation}
          onReleaseOrder={onReleaseOrderReservations}
          onRefresh={onRefreshReservations}
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
          truncated={movementsTruncated}
          onLoadMore={onLoadMoreMovements}
          warehouses={warehouses}
          components={components}
          isManager={isManager}
          pushToast={pushToast}
          onChanged={() => {
            onRefreshMovements()
            onRefreshStock()
          }}
        />
      ) : activeSubTab === 'Przyjęcia' ? (
        <PzView
          pzGroups={pzGroups}
          loading={pzGroupsLoading}
          isManager={canMovements}
          warehouses={warehouses}
          onCreate={onPzCreate}
          onPreview={onPzPreview}
        />
      ) : activeSubTab === 'Przesunięcia' ? (
        <MmView
          mmGroups={mmGroups}
          loading={mmGroupsLoading}
          isManager={canMovements}
          warehouses={warehouses}
          onCreate={onMmCreate}
          onPreview={onMmPreview}
        />
      ) : activeSubTab === 'Prognozy' ? (
        <ForecastView components={components} suppliers={suppliers} isManager={isManager} />
      ) : activeSubTab === 'Alerty' ? (
        <AlertsView isManager={isManager} />
      ) : activeSubTab === 'Zamawianie' ? (
        <ReorderDashboardView
          components={components}
          suppliers={suppliers}
          stock={stock}
          incoming={incomingStock}
          componentsLoading={componentsLoading}
          stockLoading={stockLoading}
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
          incoming={incomingStock}
          incomingLoading={incomingStockLoading}
          onRefreshIncoming={onRefreshIncoming}
        />
      ) : activeSubTab === 'Inwentaryzacja' ? (
        <InventoryView pushToast={pushToast} currentUser={currentUser} components={components} />
      ) : (
        <p className="no-results">Widok w przygotowaniu</p>
      )}
    </div>
  )
}

export default WarehouseView
