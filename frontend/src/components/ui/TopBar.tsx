import type { ModelInfo } from '@/types'

interface Props {
  loadedModel: ModelInfo | null
  onUnload: () => void
  loading: boolean
}

function EchoLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8.5" stroke="rgba(74,158,191,0.18)" strokeWidth="1"/>
      <circle cx="10" cy="10" r="5.5" stroke="rgba(74,158,191,0.40)" strokeWidth="1.1"/>
      <circle cx="10" cy="10" r="2.5" fill="#4A9EBF"/>
    </svg>
  )
}

// TopBar = branding uniquement. Modèle → chat header. GPU → sidebar.
export function TopBar(_props: Props) {
  return (
    <header
      className="h-11 shrink-0 flex items-center px-5 z-20"
      style={{
        background: 'rgba(5, 7, 14, 0.82)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <EchoLogo />
      <span className="ml-2.5 text-sm font-semibold tracking-tight text-white/88">EchoHub</span>
    </header>
  )
}
