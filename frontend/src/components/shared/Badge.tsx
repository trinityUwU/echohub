interface BadgeProps {
  variant: 'quant' | 'cap' | 'think' | 'vision' | 'gated' | 'loaded' | 'dl'
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
}

export function Badge({ variant, children }: BadgeProps): React.ReactElement {
  return (
    <span className={`text-2xs font-medium px-1.5 py-0.5 rounded-sm ${STYLES[variant]}`}>
      {children}
    </span>
  )
}
