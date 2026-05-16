type Page = 'chat' | 'library' | 'discover' | 'downloads' | 'settings'

interface NavRailProps {
  active: Page
  onNavigate: (p: Page) => void
  downloadsBadge?: boolean
}



export function NavRail({ active, onNavigate, downloadsBadge }: NavRailProps): React.ReactElement {
  return (
    <nav className="w-[54px] bg-surface border-r border-border flex flex-col items-center py-3 gap-1 flex-shrink-0 z-10">
      <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center mb-3 flex-shrink-0">
        <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="none">
          <path d="M3 10 C3 5.5 6.5 2 11 2 s8 3.5 8 8 -3.5 8-8 8" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
          <circle cx="7" cy="10" r="1.3" fill="white"/>
          <circle cx="11" cy="10" r="1.3" fill="white"/>
          <circle cx="15" cy="10" r="1.3" fill="white"/>
        </svg>
      </div>

      <NavItem id="chat" title="Chat" active={active === 'chat'} onClick={() => onNavigate('chat')}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </NavItem>
      <NavItem id="library" title="My Models" active={active === 'library'} onClick={() => onNavigate('library')}>
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
      </NavItem>
      <NavItem id="discover" title="Discover" active={active === 'discover'} onClick={() => onNavigate('discover')}>
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </NavItem>
      <NavItem id="downloads" title="Downloads" active={active === 'downloads'} onClick={() => onNavigate('downloads')} badge={downloadsBadge}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </NavItem>

      <div className="flex-1" />

      <NavItem id="settings" title="Settings" active={active === 'settings'} onClick={() => onNavigate('settings')}>
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </NavItem>
    </nav>
  )
}

interface NavItemProps {
  id: string
  title: string
  active: boolean
  onClick: () => void
  badge?: boolean
  children: React.ReactNode
}

function NavItem({ title, active, onClick, badge, children }: NavItemProps): React.ReactElement {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`relative w-[38px] h-[38px] rounded-sm flex items-center justify-center cursor-pointer transition-colors duration-100 ${
        active ? 'bg-accent-dim text-accent' : 'text-text-muted hover:bg-overlay hover:text-text-secondary'
      }`}
    >
      <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      {badge && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-accent rounded-full border-[1.5px] border-surface" />
      )}
    </button>
  )
}
