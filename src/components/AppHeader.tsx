import { useState } from 'react'
import { X, Layers, Database, ShieldCheck, Zap, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react'
import packageJson from '../../package.json'
import NotificationBell from './NotificationBell'

// ---------------------------------------------------------------------------
// IPC helper (tylko do invoke — bez globalnego augmentowania Window)
// ---------------------------------------------------------------------------

type CheckResult =
  | { status: 'uptodate' }
  | { status: 'available'; version: string }
  | { status: 'error'; message: string }

type AboutIpc = { invoke: (ch: string) => Promise<CheckResult | null> }

function getIpc(): AboutIpc | undefined {
  return (window as Window & { ipcRenderer?: AboutIpc }).ipcRenderer
}

// ---------------------------------------------------------------------------
// About Modal
// ---------------------------------------------------------------------------

type CheckState = 'idle' | 'checking' | 'uptodate' | 'available' | 'error'

function AboutModal({ onClose }: { onClose: () => void }) {
  const [checkState, setCheckState] = useState<CheckState>('idle')
  const [updateVersion, setUpdateVersion] = useState('')

  const stack = [
    { icon: <Layers size={14} />, label: 'Electron 30 + React 18 + TypeScript + Vite 5' },
    { icon: <Database size={14} />, label: 'Supabase — Postgres, Auth, Edge Functions, Storage' },
    { icon: <ShieldCheck size={14} />, label: 'Sentry — error tracking + source maps' },
    { icon: <Zap size={14} />, label: 'pdfmake, Recharts, Lucide, electron-builder' },
  ]

  const handleCheckUpdates = async () => {
    setCheckState('checking')
    const result = await getIpc()?.invoke('updater:check')
    if (!result) {
      setCheckState('uptodate')
      return
    }
    if (result.status === 'available') {
      setUpdateVersion(result.version)
      setCheckState('available')
    } else if (result.status === 'error') {
      setCheckState('error')
    } else {
      setCheckState('uptodate')
    }
  }

  // Feedback po sprawdzeniu
  const checkFeedback: Record<Exclude<CheckState, 'idle' | 'checking'>, { icon: React.ReactNode; text: string; color: string }> = {
    uptodate: {
      icon: <CheckCircle size={14} />,
      text: 'Masz najnowszą wersję',
      color: '#1d6d45',
    },
    available: {
      icon: <Zap size={14} />,
      text: `Dostępna aktualizacja v${updateVersion} — sprawdź banner na górze`,
      color: '#1b304a',
    },
    error: {
      icon: <AlertTriangle size={14} />,
      text: 'Nie udało się sprawdzić — spróbuj później',
      color: '#b3261e',
    },
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
      <div
        className="modal-content"
        style={{ maxWidth: 420, padding: 0, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header granatowy */}
        <div style={{ background: 'var(--color-primary, #1b304a)', padding: '1.5rem', position: 'relative' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              position: 'absolute', top: '0.75rem', right: '0.75rem',
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '6px',
              color: 'white', cursor: 'pointer', padding: '4px 6px', lineHeight: 1,
            }}
          >
            <X size={14} />
          </button>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
            KR Center
          </div>
          <div style={{ color: 'white', fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            Manager Produkcji
          </div>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.85rem' }}>
            wersja {packageJson.version}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem 1.5rem' }}>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: 'var(--color-text-muted, #6b7280)', lineHeight: 1.6 }}>
            {packageJson.description}
          </p>

          {/* Stack */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted, #9ca3af)', marginBottom: '0.5rem' }}>
              Stack techniczny
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {stack.map(({ icon, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--color-text, #374151)' }}>
                  <span style={{ color: 'var(--color-primary, #1b304a)', flexShrink: 0 }}>{icon}</span>
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{ borderTop: '1px solid var(--color-border, #e5e7eb)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #9ca3af)' }}>
                © {new Date().getFullYear()} {packageJson.author.name}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #9ca3af)' }}>
                {packageJson.author.email}
              </div>
            </div>

            {/* Sprawdź aktualizacje — przycisk + feedback */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={checkState === 'checking'}
                style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                onClick={() => void handleCheckUpdates()}
              >
                <RefreshCw
                  size={13}
                  style={checkState === 'checking' ? { animation: 'spin 1s linear infinite' } : {}}
                />
                {checkState === 'checking' ? 'Sprawdzam…' : 'Sprawdź aktualizacje'}
              </button>

              {/* Wynik sprawdzenia */}
              {checkState !== 'idle' && checkState !== 'checking' && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  fontSize: '0.8rem', color: checkFeedback[checkState].color,
                  padding: '0.4rem 0.6rem',
                  background: checkState === 'uptodate' ? '#d8f0e4' : checkState === 'available' ? '#dbeafe' : '#fde5e3',
                  borderRadius: '6px',
                }}>
                  {checkFeedback[checkState].icon}
                  {checkFeedback[checkState].text}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AppHeader
// ---------------------------------------------------------------------------

type AppHeaderProps = {
  activeTab: string
  isCompaniesTab: boolean
  isConfigTab: boolean
  isUsersTab: boolean
  isWarehouseTab: boolean
  isStatsTab: boolean
  isReviewTab: boolean
  isAuditTab: boolean
  isArchiveTab: boolean
  isMyStationTab: boolean
  isShippingTab: boolean
  isApiKeysTab: boolean
  currentUserFullName: string
  currentUserId: string
  onNavigateTab: (tab: string) => void
  onAddContractor: () => void
  onAddUser: () => void
  onNewOrder: () => void
  onSignOut: () => void
}

export default function AppHeader({
  activeTab,
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
  currentUserFullName,
  currentUserId,
  onNavigateTab,
  onAddContractor,
  onAddUser,
  onNewOrder,
  onSignOut,
}: AppHeaderProps) {
  const [showAbout, setShowAbout] = useState(false)

  const isNoActionTab =
    isConfigTab ||
    isWarehouseTab ||
    isStatsTab ||
    isReviewTab ||
    isAuditTab ||
    isArchiveTab ||
    isMyStationTab ||
    isShippingTab ||
    isApiKeysTab ||
    activeTab === 'Pulpit' ||
    activeTab === 'Zamawianie' ||
    activeTab === 'Inwentaryzacja'

  const sectionTitle: Record<string, string> = {
    'Moje stanowisko': 'Moje stanowisko',
    STA: 'Zamówienia STA',
    Disting: 'Zamówienia Disting',
    ST: 'Zamówienia ST',
    Techniczne: 'Zamówienia Techniczne',
    Bastion: 'Zamówienia Bastion',
    DrzwiWewnetrzne: 'Drzwi Wewnętrzne',
    Statystyki: 'Statystyki',
    Weryfikacja: 'Weryfikacja BOT',
    Audyt: 'Audyt',
    Archiwum: 'Archiwum',
    Wysyłka: 'Wysyłka',
    Magazyn: 'Magazyn',
    Zamawianie: 'Zamawianie towaru',
    Inwentaryzacja: 'Inwentaryzacja',
    Pulpit: 'Pulpit',
    Kontrahenci: 'Kontrahenci',
    Konfiguracja: 'Konfiguracja',
    Użytkownicy: 'Użytkownicy',
    'Klucze API': 'Klucze API',
  }

  return (
    <>
      <header className="app-toolbar">
        <h2 className="app-toolbar-title">{sectionTitle[activeTab] ?? activeTab}</h2>

        <div className="app-toolbar-right">
          {isCompaniesTab ? (
            <button className="btn btn-success btn-sm" onClick={onAddContractor}>
              Dodaj kontrahenta
            </button>
          ) : isNoActionTab ? null : isUsersTab ? (
            <button type="button" className="btn btn-success btn-sm" onClick={onAddUser}>
              Dodaj użytkownika
            </button>
          ) : (
            <button className="btn btn-success btn-sm" onClick={onNewOrder}>
              + Nowe zamówienie
            </button>
          )}

          <div className="app-toolbar-user">
            <NotificationBell currentUserId={currentUserId} onNavigate={onNavigateTab} />
            <span className="app-toolbar-username">{currentUserFullName}</span>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setShowAbout(true)}
              title={`KR Center Manager Produkcji v${packageJson.version}`}
            >
              v{packageJson.version}
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={onSignOut}>
              Wyloguj
            </button>
          </div>
        </div>
      </header>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </>
  )
}
