import { createContext, useContext, useRef, useEffect } from 'react'

export const AutoScrollContext = createContext(true)

/** Scroll a container ref to the bottom when content updates, respecting autoScroll. */
export function useScrollToBottom(
  deps: unknown[],
  streaming: boolean | undefined,
): React.RefObject<HTMLElement | null> {
  const autoScroll = useContext(AutoScrollContext)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!streaming || !autoScroll) return
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, streaming, autoScroll])

  return ref
}
