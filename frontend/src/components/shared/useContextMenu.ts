import { useContext } from 'react'
import { ContextMenuCtx } from './ContextMenu'

export function useContextMenu() {
  return useContext(ContextMenuCtx)
}
