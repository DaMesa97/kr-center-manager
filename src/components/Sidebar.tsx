import { useState, useMemo } from 'react'
import { User, DoorOpen, Factory, Package, Settings, ChevronRight, Key, LayoutDashboard, HelpCircle, MessageSquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CATEGORY_LABELS } from '../constants'

type TabGroupDef =
  | { type: 'standalone'; tab: string; Icon: LucideIcon; label: string }
  | { type: 'group'; id: string; label: string; Icon: LucideIcon; tabs: readonly string[] }

const TAB_GROUPS: TabGroupDef[] = [
  {
    type: 'standalone',
    tab: 'Pulpit',
    Icon: LayoutDashboard,
    label: 'Pulpit',
  },
  {
    type: 'standalone',
    tab: 'Moje stanowisko',
    Icon: User,
    label: 'Moje stanowisko',
  },
  {
    type: 'group',
    id: 'orders',
    label: 'Zamówienia',
    Icon: DoorOpen,
    tabs: ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne'],
  },
  {
    type: 'group',
    id: 'production',
    label: 'Produkcja',
    Icon: Factory,
    tabs: ['Wysyłka', 'Statystyki', 'Weryfikacja', 'Etykiety'],
  },
  {
    type: 'group',
    id: 'warehouse',
    label: 'Magazyn',
    Icon: Package,
    tabs: ['Magazyn', 'Zamawianie', 'Inwentaryzacja', 'Kontrahenci'],
  },
  {
    type: 'group',
    id: 'admin',
    label: 'Administracja',
    Icon: Settings,
    tabs: ['Konfiguracja', 'Użytkownicy', 'Klucze API', 'Audyt', 'Archiwum'],
  },
  {
    type: 'standalone',
    tab: 'Zgłoszenia',
    Icon: MessageSquare,
    label: 'Zgłoszenia',
  },
  {
    type: 'standalone',
    tab: 'Pomoc',
    Icon: HelpCircle,
    label: 'Pomoc',
  },
]

type Props = {
  visibleTabs: string[]
  activeTab: string
  onChange: (tab: string) => void
  reviewCount?: number
  warehouseAlertsCount?: number
  overdueCount?: number
}

export default function Sidebar({ visibleTabs, activeTab, onChange, reviewCount = 0, warehouseAlertsCount = 0, overdueCount = 0 }: Props) {
  const visible = useMemo(() => new Set(visibleTabs), [visibleTabs])

  const activeGroupId = useMemo(() => {
    for (const group of TAB_GROUPS) {
      if (group.type === 'group' && (group.tabs as readonly string[]).includes(activeTab)) {
        return group.id
      }
    }
    return null
  }, [activeTab])

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    if (activeGroupId) initial.add(activeGroupId)
    return initial
  })

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Auto-expand group when active tab changes
  useMemo(() => {
    if (activeGroupId) {
      setExpandedGroups((prev) => {
        if (prev.has(activeGroupId)) return prev
        return new Set([...prev, activeGroupId])
      })
    }
  }, [activeGroupId])

  return (
    <aside className="app-sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <span className="sidebar-logo-name">KR Center</span>
        <span className="sidebar-logo-sub">Manager Produkcji</span>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav" style={{ flex: 1 }}>
        {TAB_GROUPS.map((entry) => {
          if (entry.type === 'standalone') {
            if (!visible.has(entry.tab)) return null
            const Icon = entry.Icon
            return (
              <button
                key={entry.tab}
                type="button"
                className={`sidebar-item ${activeTab === entry.tab ? 'sidebar-item--active' : ''}`}
                onClick={() => onChange(entry.tab)}
              >
                <Icon size={15} className="sidebar-item-icon" />
                <span>{entry.label}</span>
              </button>
            )
          }

          const groupTabs = (entry.tabs as readonly string[]).filter((t) => visible.has(t))
          if (groupTabs.length === 0) return null

          const isGroupActive = groupTabs.includes(activeTab)
          const isExpanded = expandedGroups.has(entry.id)
          const GroupIcon = entry.Icon

          return (
            <div key={entry.id} className="sidebar-group">
              <button
                type="button"
                className={`sidebar-group-header ${isGroupActive ? 'sidebar-group-header--active' : ''}`}
                onClick={() => toggleGroup(entry.id)}
              >
                <GroupIcon size={15} className="sidebar-item-icon" />
                <span className="sidebar-group-label">{entry.label}</span>
                {entry.id === 'warehouse' && warehouseAlertsCount > 0 && (
                  <span className="sidebar-badge sidebar-badge--alert">{warehouseAlertsCount}</span>
                )}
                <ChevronRight
                  size={13}
                  className={`sidebar-group-arrow ${isExpanded ? 'sidebar-group-arrow--open' : ''}`}
                />
              </button>

              {isExpanded && (
                <div className="sidebar-group-items">
                  {groupTabs.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`sidebar-item sidebar-item--child ${t === activeTab ? 'sidebar-item--active' : ''}`}
                      onClick={() => onChange(t)}
                    >
                      {t === 'Klucze API' && <Key size={13} className="sidebar-item-icon" />}
                      <span>{CATEGORY_LABELS[t as keyof typeof CATEGORY_LABELS] ?? t}</span>
                      {t === 'Weryfikacja' && reviewCount > 0 && (
                        <span className="sidebar-badge">{reviewCount}</span>
                      )}
                      {t === 'Wysyłka' && overdueCount > 0 && (
                        <span className="sidebar-badge sidebar-badge--alert">{overdueCount}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Wersja */}
      <div className="sidebar-version">v{__APP_VERSION__}</div>
    </aside>
  )
}
