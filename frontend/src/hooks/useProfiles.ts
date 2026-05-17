import { useCallback, useState } from 'react'
import type { ChatParams, ChatProfile } from '@/types'

const STORAGE_KEY = 'echohub:profiles'
const ACTIVE_KEY  = 'echohub:active-profile'

const BUILTIN_PROFILES: ChatProfile[] = [
  {
    id: 'default',
    name: 'Default',
    params: {
      systemPrompt: '', temperature: 0.7, maxTokens: 4096,
      topP: 0.95, topK: -1, repetitionPenalty: 1.1,
      presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: false,
    },
  },
  {
    id: 'coder',
    name: 'Coder',
    params: {
      systemPrompt: 'You are an expert software engineer. Write clean, correct, well-structured code.',
      temperature: 0.2, maxTokens: 4096,
      topP: 0.95, topK: -1, repetitionPenalty: 1.05,
      presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: true,
    },
  },
  {
    id: 'creative',
    name: 'Creative',
    params: {
      systemPrompt: '',
      temperature: 1.1, maxTokens: 4096,
      topP: 0.98, topK: 50, repetitionPenalty: 1.15,
      presencePenalty: 0.1, frequencyPenalty: 0, stop: '', enableThinking: false,
    },
  },
]

function loadProfiles(): ChatProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return BUILTIN_PROFILES
    const saved: ChatProfile[] = JSON.parse(raw)
    const builtinIds = new Set(BUILTIN_PROFILES.map(p => p.id))
    const custom = saved.filter(p => !builtinIds.has(p.id))
    // Builtins: use saved version if user explicitly saved it (has userModified flag),
    // otherwise fall back to code defaults (picks up new defaults on update)
    const mergedBuiltins = BUILTIN_PROFILES.map(builtin => {
      const savedVersion = saved.find(s => s.id === builtin.id)
      if (savedVersion && (savedVersion as ChatProfile & { userModified?: boolean }).userModified) {
        return savedVersion
      }
      return builtin
    })
    return [...mergedBuiltins, ...custom]
  } catch {
    return BUILTIN_PROFILES
  }
}

function persistProfiles(profiles: ChatProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles))
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<ChatProfile[]>(loadProfiles)
  const [activeId, setActiveId] = useState<string>(
    () => localStorage.getItem(ACTIVE_KEY) ?? 'default'
  )

  const activeProfile = profiles.find(p => p.id === activeId) ?? profiles[0]

  const selectProfile = useCallback((id: string): ChatParams => {
    setActiveId(id)
    localStorage.setItem(ACTIVE_KEY, id)
    return profiles.find(p => p.id === id)?.params ?? profiles[0].params
  }, [profiles])

  const saveProfile = useCallback((id: string, name: string, params: ChatParams): void => {
    setProfiles(prev => {
      const exists = prev.find(p => p.id === id)
      // Mark userModified so loadProfiles() knows this builtin was intentionally changed
      const profile = { id, name, params, userModified: true } as ChatProfile & { userModified: boolean }
      const updated = exists
        ? prev.map(p => p.id === id ? profile : p)
        : [...prev, profile]
      persistProfiles(updated)
      return updated
    })
    setActiveId(id)
    localStorage.setItem(ACTIVE_KEY, id)
  }, [])

  const deleteProfile = useCallback((id: string): void => {
    // Built-in profiles cannot be deleted
    if (id === 'default') return
    setProfiles(prev => {
      const updated = prev.filter(p => p.id !== id)
      persistProfiles(updated)
      return updated
    })
    if (activeId === id) {
      setActiveId('default')
      localStorage.setItem(ACTIVE_KEY, 'default')
    }
  }, [activeId])

  return { profiles, activeId, activeProfile, selectProfile, saveProfile, deleteProfile }
}
