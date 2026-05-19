interface BadgeProps {
  variant: 'quant' | 'cap' | 'think' | 'vision' | 'gated' | 'loaded' | 'dl' | 'ft' | 'mtp'
  children: React.ReactNode
}

const STYLES: Record<BadgeProps['variant'], string> = {
  quant:  'bg-blue/15 text-blue',
  cap:    'bg-white/6 text-text-muted',
  think:  'bg-yellow/12 text-yellow',
  vision: 'bg-green/12 text-green',
  gated:  'bg-red/12 text-red',
  loaded: 'bg-accent/18 text-accent',
  dl:     'bg-green/12 text-green',
  ft:     'bg-purple-500/15 text-purple-400',
  mtp:    'bg-cyan-500/15 text-cyan-400',
}

export function Badge({ variant, children }: BadgeProps): React.ReactElement {
  return (
    <span className={`text-2xs font-medium px-1.5 py-0.5 rounded-sm ${STYLES[variant]}`}>
      {children}
    </span>
  )
}
