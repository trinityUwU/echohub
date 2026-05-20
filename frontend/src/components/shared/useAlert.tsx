import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useRef, useState } from 'react'

interface AlertState {
  title: string
  message: string
}

export function useAlert(): {
  show: (title: string, message: string) => void
  element: React.ReactElement | null
} {
  const [state, setState] = useState<AlertState | null>(null)
  const resolveRef = useRef<(() => void) | null>(null)

  const show = useCallback((title: string, message: string): void => {
    setState({ title, message })
  }, [])

  const close = useCallback((): void => {
    setState(null)
    resolveRef.current?.()
    resolveRef.current = null
  }, [])

  const element = (
    <AnimatePresence>
      {state && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={e => { if (e.target === e.currentTarget) close() }}
        >
          <motion.div
            className="bg-surface border border-border-hover rounded-lg w-[360px] shadow-[0_24px_60px_rgba(0,0,0,0.5)] overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
          >
            <div className="px-5 pt-5 pb-4">
              <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">{state.title}</p>
              <p className="text-sm text-text-primary font-mono leading-relaxed">{state.message}</p>
            </div>
            <div className="px-5 pb-4 flex justify-end">
              <button
                onClick={close}
                autoFocus
                className="px-4 py-1.5 text-sm bg-elevated border border-border hover:border-border-hover text-text-secondary hover:text-text-primary rounded-sm transition-colors cursor-pointer"
              >
                OK
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return { show, element: state ? element : null }
}
