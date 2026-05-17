import { createContext, useContext, useCallback, useEffect, useState, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  danger?: boolean
  separator?: boolean
  onClick: () => void
}

interface MenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

interface ContextMenuCtx {
  open: (e: React.MouseEvent, items: ContextMenuItem[]) => void
}

const Ctx = createContext<ContextMenuCtx>({ open: () => {} })

export function useContextMenu(): ContextMenuCtx {
  return useContext(Ctx)
}

export function ContextMenuProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const open = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [])

  // Block native context menu everywhere
  useEffect(() => {
    const block = (e: MouseEvent) => e.preventDefault()
    window.addEventListener('contextmenu', block)
    return () => window.removeEventListener('contextmenu', block)
  }, [])

  // Close on outside click or Escape
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [menu])

  // Adjust position if menu would go off-screen
  const adjustedPos = menu ? (() => {
    const W = window.innerWidth
    const H = window.innerHeight
    const menuW = 180
    const menuH = menu.items.length * 34 + 16
    return {
      x: menu.x + menuW > W ? menu.x - menuW : menu.x,
      y: menu.y + menuH > H ? menu.y - menuH : menu.y,
    }
  })() : null

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {menu && adjustedPos && (
        <div
          ref={menuRef}
          className="fixed z-[9999] bg-elevated border border-border rounded-md shadow-2xl py-1 min-w-[160px]"
          style={{ left: adjustedPos.x, top: adjustedPos.y }}
        >
          {menu.items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-muted italic">No actions available</div>
          ) : (
            menu.items.map((item, i) => (
              item.separator ? (
                <div key={i} className="h-px bg-white/8 mx-2 my-1" />
              ) : (
                <button key={i}
                  onClick={() => { item.onClick(); setMenu(null) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                    item.danger
                      ? 'text-red hover:bg-red/10'
                      : 'text-text-secondary hover:bg-overlay hover:text-text-primary'
                  }`}>
                  {item.icon && <span className="w-3.5 h-3.5 flex-shrink-0">{item.icon}</span>}
                  {item.label}
                </button>
              )
            ))
          )}
        </div>
      )}
    </Ctx.Provider>
  )
}
