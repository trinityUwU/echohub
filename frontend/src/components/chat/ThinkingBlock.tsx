import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  content: string
  streaming?: boolean
}

export function ThinkingBlock({ content, streaming }: Props) {
  const [open, setOpen] = useState(false)
  const wordCount = content.split(/\s+/).filter(Boolean).length

  return (
    <div className="bg-surface-2/40 rounded-lg mb-1 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 select-none cursor-pointer hover:bg-white/[0.02] transition-colors"
      >
        <svg className="w-3 h-3 text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span className="text-2xs text-muted/50">Thought process</span>
        <span className="text-2xs font-mono text-muted/30">· {wordCount} words</span>
        {streaming && <span className="text-2xs text-accent/50 animate-pulse">thinking…</span>}
        <span className={`ml-auto text-muted/30 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <p className="px-3 pb-3 text-xs text-muted/55 italic leading-relaxed whitespace-pre-wrap">
              {content}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
