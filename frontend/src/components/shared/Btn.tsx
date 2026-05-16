import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger'
  children: ReactNode
}

const STYLES = {
  primary: 'bg-accent hover:bg-accent-hover text-white border-accent',
  ghost:   'bg-transparent hover:bg-overlay text-text-secondary border-border',
  danger:  'bg-transparent hover:bg-red/10 text-red border-red/30',
}

export function Btn({ variant = 'ghost', children, className = '', ...rest }: BtnProps): React.ReactElement {
  return (
    <button
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm font-medium border cursor-pointer transition-colors duration-150 ${STYLES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
