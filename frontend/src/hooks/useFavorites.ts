import { useCallback, useState } from 'react'
import type { ModelInfo } from '@/types'

const STORAGE_KEY = 'echohub:favorites'

function load(): ModelInfo[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<ModelInfo[]>(load)

  const isFavorite = useCallback((id: string): boolean =>
    favorites.some(m => m.id === id), [favorites])

  const toggleFavorite = useCallback((model: ModelInfo): void => {
    setFavorites(prev => {
      const next = prev.some(m => m.id === model.id)
        ? prev.filter(m => m.id !== model.id)
        : [...prev, model]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const removeFavorite = useCallback((id: string): void => {
    setFavorites(prev => {
      const next = prev.filter(m => m.id !== id)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { favorites, isFavorite, toggleFavorite, removeFavorite }
}
