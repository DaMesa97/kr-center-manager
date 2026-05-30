import { useState, useEffect, useRef, useMemo } from 'react'
import type { LucideIcon } from 'lucide-react'
import { User, DoorOpen, Factory, Package, Settings, ChevronDown } from 'lucide-react'
import { CATEGORY_LABELS } from '../constants'

type TabGroupDef =
  | { type: 'standalone'; tab: string; Icon: LucideIcon; label: string }
  | { type: 'group'; id: string; label: string; Icon: LucideIcon; tabs: readonly string[] }

const TAB_GROUPS: TabGroupDef[] = [
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
    tabs: ['Wysyłka', 'Statystyki', 'Weryfikacja'],
  },
  {
    type: 'group',
    id: 'warehouse',
    label: 'Magazyn',
    Icon: Package,
    tabs: ['Magazyn', 'Kontrahenci'],
  },
  {
    type: 'group',
    id: 'admin',
    label: 'Administracja',
    Icon: Settings,
    tabs: ['Konfiguracja', 'Użytkownicy', 'Audyt', 'Archiwum'],
  },
]

type Props = {
  visibleTabs: string[]
  activeTab: string
  onChange: (tab: string) => void
  reviewCount?: number
}

export default function NavTabs({ visibleTabs, activeTab, onChange, reviewCount = 0 }: Props) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const containerRef = useRef<HTMLElement>(null)

  const visible = useMemo(() => new Set(visibleTabs), [visibleTabs])

  useEffect(() => {
    if (openDropdown === null) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpenDropdown(null)
      }
    }
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenDropdown(null)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', escHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', escHandler)
    }
  }, [openDropdown])

  return (
    <nav ref={containerRef} className="nav-tabs" aria-label="Kategorie zamówień">
      {TAB_GROUPS.map((entry) => {
        if (entry.type === 'standalone') {
          if (!visible.has(entry.tab)) return null
          const StandaloneIcon = entry.Icon
          return (
            <button
              key={entry.tab}
              type="button"
              className={`nav-standalone-btn ${activeTab === entry.tab ? 'nav-standalone-btn--active' : ''}`}
              onClick={() => onChange(entry.tab)}
            >
              <StandaloneIcon size={16} strokeWidth={2} className="nav-group-icon" />
              <span className="nav-group-label">{entry.label}</span>
            </button>
          )
        }

        const tabsInGroup = entry.tabs.filter((t) => visible.has(t))
        if (tabsInGroup.length === 0) return null

        const isActive = tabsInGroup.includes(activeTab)
        const GroupIcon = entry.Icon

        return (
          <div key={entry.id} className="nav-group">
            <button
              type="button"
              className={`nav-group-btn ${isActive ? 'nav-group-btn--active' : ''}`}
              onClick={() => setOpenDropdown(openDropdown === entry.id ? null : entry.id)}
            >
              <GroupIcon size={16} strokeWidth={2} className="nav-group-icon" />
              <span className="nav-group-label">
                {isActive ? `${entry.label}: ${CATEGORY_LABELS[activeTab as keyof typeof CATEGORY_LABELS] ?? activeTab}` : entry.label}
              </span>
              <ChevronDown
                size={14}
                strokeWidth={2.5}
                className={`nav-group-arrow ${openDropdown === entry.id ? 'nav-group-arrow--open' : ''}`}
              />
            </button>
            {openDropdown === entry.id && (
              <div className="nav-group-dropdown">
                {tabsInGroup.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`nav-group-dropdown-item ${t === activeTab ? 'nav-group-dropdown-item--active' : ''}`}
                    onClick={() => {
                      onChange(t)
                      setOpenDropdown(null)
                    }}
                  >
                    <span>{CATEGORY_LABELS[t as keyof typeof CATEGORY_LABELS] ?? t}</span>
                    {t === 'Weryfikacja' && reviewCount > 0 && (
                      <span className="main-tab-badge main-tab-badge--alert">{reviewCount}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
