import { useState, type ReactNode } from 'react'

interface AccordionProps {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}

export function Accordion({ title, defaultOpen = true, children }: AccordionProps): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="flex-1 text-xs font-semibold uppercase tracking-widest text-text-muted">
          {title}
        </span>
        <svg
          className={`w-3.5 h-3.5 stroke-text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="px-3.5 pb-3.5">{children}</div>}
    </div>
  )
}
