import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useScrollToBottom } from '@/hooks/useAutoScroll'

interface Props {
  content: string
  streaming?: boolean
}

export function ThinkingBlock({ content, streaming }: Props) {
  const [open, setOpen] = useState(false)
  const scrollRef = useScrollToBottom([content], streaming) as React.RefObject<HTMLDivElement>

  return (
    <div className="mb-3 rounded-xl border border-violet-500/20 bg-violet-500/5 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-violet-500/10 transition-colors"
      >
        <span className={`text-xs ${streaming ? 'text-violet-400 animate-pulse' : 'text-violet-300'}`}>
          {streaming ? '💭 Thinking…' : '💭 Thought process'}
        </span>
        <span className="text-xs text-violet-400/60 ml-auto">
          {content.split(' ').length} words
        </span>
        <svg
          className={`w-3.5 h-3.5 text-violet-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div
              ref={scrollRef as React.RefObject<HTMLDivElement>}
              className="px-3 pb-3 text-xs text-violet-200/70 leading-relaxed whitespace-pre-wrap border-t border-violet-500/10 pt-2 font-mono max-h-64 overflow-y-auto"
            >
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
