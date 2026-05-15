import type { ModelCapabilities } from '@/types'

interface Props {
  capabilities: ModelCapabilities
  size?: 'sm' | 'md'
  className?: string
}

interface CapMeta {
  label: string
  shortLabel: string
  bg: string
  icon: React.ReactNode
}

const EyeIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
)

const BrainIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
)

const TerminalIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
)

const GlobeIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
  </svg>
)

const WrenchIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const CAP_META: Record<keyof ModelCapabilities, CapMeta> = {
  vision: {
    label: 'Vision',
    shortLabel: 'Vision',
    bg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    icon: <EyeIcon className="w-3 h-3" />,
  },
  thinking: {
    label: 'Reasoning',
    shortLabel: 'Reason',
    bg: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    icon: <BrainIcon className="w-3 h-3" />,
  },
  code: {
    label: 'Code',
    shortLabel: 'Code',
    bg: 'bg-green-500/20 text-green-300 border-green-500/30',
    icon: <TerminalIcon className="w-3 h-3" />,
  },
  multilingual: {
    label: 'Multilingual',
    shortLabel: 'Multi',
    bg: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    icon: <GlobeIcon className="w-3 h-3" />,
  },
  tools: {
    label: 'Tool Use',
    shortLabel: 'Tools',
    bg: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    icon: <WrenchIcon className="w-3 h-3" />,
  },
}

export function CapabilityBadges({ capabilities, size = 'md', className = '' }: Props): React.ReactElement | null {
  const active = (Object.keys(CAP_META) as Array<keyof ModelCapabilities>).filter(k => capabilities[k])

  if (active.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {active.map(cap => {
        const meta = CAP_META[cap]
        return (
          <span
            key={cap}
            className={`text-xs px-2 py-0.5 rounded-md border flex items-center gap-1 ${meta.bg}`}
            title={meta.label}
          >
            {meta.icon}
            {size === 'md' ? meta.label : meta.shortLabel}
          </span>
        )
      })}
    </div>
  )
}
