import { useCallback, useState } from 'react'
import type { ChatParams, ChatProfile } from '@/types'
import type { ProjectMode } from './useChatMode'

const STORAGE_KEY = 'echohub:profiles'
const ACTIVE_KEY  = 'echohub:active-profile'

const CHAT_BUILTINS: ChatProfile[] = [
  {
    id: 'default',
    name: 'Default',
    params: {
      systemPrompt: '', permanentRules: '', temperature: 0.7, maxTokens: 4096,
      topP: 0.95, topK: -1, repetitionPenalty: 1.1,
      presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: false,
    },
  },
  {
    id: 'coder',
    name: 'Coder',
    params: {
      systemPrompt: 'You are an expert software engineer. Write clean, correct, well-structured code.',
      permanentRules: '', temperature: 0.2, maxTokens: 4096,
      topP: 0.95, topK: -1, repetitionPenalty: 1.05,
      presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: true,
    },
  },
  {
    id: 'creative',
    name: 'Creative',
    params: {
      systemPrompt: '', permanentRules: '',
      temperature: 1.1, maxTokens: 4096,
      topP: 0.98, topK: 50, repetitionPenalty: 1.15,
      presencePenalty: 0.1, frequencyPenalty: 0, stop: '', enableThinking: false,
    },
  },
]

const PROJECT_BUILTINS: Record<ProjectMode, ChatProfile[]> = {
  dev: [
    {
      id: 'dev-default',
      name: 'Dev',
      params: {
        systemPrompt: 'You are an expert software engineer. Analyze the project files, write clean and correct code, explain your reasoning step by step.',
        permanentRules: '- Always verify imports exist\n- Never use blocking calls in async\n- Check all edge cases',
        temperature: 0.2, maxTokens: 8192,
        topP: 0.95, topK: -1, repetitionPenalty: 1.05,
        presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: true,
      },
    },
    {
      id: 'dev-debug',
      name: 'Debug',
      params: {
        systemPrompt: 'You are a debugging expert. Identify root causes, explain why bugs occur, and provide minimal targeted fixes.',
        permanentRules: '- Always show the full stack trace analysis\n- Propose only the minimal fix needed',
        temperature: 0.1, maxTokens: 4096,
        topP: 0.9, topK: -1, repetitionPenalty: 1.0,
        presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: true,
      },
    },
    {
      id: 'dev-review',
      name: 'Code Review',
      params: {
        systemPrompt: 'You are a senior engineer doing a code review. Be thorough, flag security issues, performance problems, and style violations.',
        permanentRules: '',
        temperature: 0.3, maxTokens: 4096,
        topP: 0.95, topK: -1, repetitionPenalty: 1.05,
        presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: false,
      },
    },
  ],
  docs: [
    {
      id: 'docs-default',
      name: 'Writer',
      params: {
        systemPrompt: 'You are a technical writer. Produce clear, well-structured documentation. Use markdown. Be precise and concise.',
        permanentRules: '',
        temperature: 0.5, maxTokens: 8192,
        topP: 0.95, topK: -1, repetitionPenalty: 1.1,
        presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: false,
      },
    },
    {
      id: 'docs-summarize',
      name: 'Summarizer',
      params: {
        systemPrompt: 'You are an expert at summarizing documents. Extract key points, preserve important details, and produce structured summaries.',
        permanentRules: '- Always include a TL;DR at the top\n- Use bullet points for key facts',
        temperature: 0.3, maxTokens: 4096,
        topP: 0.9, topK: -1, repetitionPenalty: 1.05,
        presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: false,
      },
    },
    {
      id: 'docs-translate',
      name: 'Translator',
      params: {
        systemPrompt: 'You are a professional translator and editor. Preserve meaning, tone, and formatting when translating or rewriting content.',
        permanentRules: '',
        temperature: 0.4, maxTokens: 8192,
        topP: 0.95, topK: -1, repetitionPenalty: 1.1,
        presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: false,
      },
    },
  ],
  research: [
    {
      id: 'research-default',
      name: 'Analyst',
      params: {
        systemPrompt: 'You are a research analyst. Synthesize information from multiple sources, identify patterns, and provide evidence-based conclusions.',
        permanentRules: '- Always cite sources when available\n- Distinguish facts from inferences',
        temperature: 0.4, maxTokens: 8192,
        topP: 0.95, topK: -1, repetitionPenalty: 1.05,
        presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: true,
      },
    },
    {
      id: 'research-brainstorm',
      name: 'Brainstorm',
      params: {
        systemPrompt: 'You are a creative research assistant. Generate ideas, explore angles, challenge assumptions, and help build new perspectives.',
        permanentRules: '',
        temperature: 0.9, maxTokens: 4096,
        topP: 0.98, topK: 50, repetitionPenalty: 1.15,
        presencePenalty: 0.1, frequencyPenalty: 0, stop: '', enableThinking: false,
      },
    },
    {
      id: 'research-factcheck',
      name: 'Fact-check',
      params: {
        systemPrompt: 'You are a fact-checker. Verify claims, identify logical fallacies, and flag unsupported assertions. Be rigorous and neutral.',
        permanentRules: '- Always explain your reasoning\n- Rate confidence: High / Medium / Low',
        temperature: 0.1, maxTokens: 4096,
        topP: 0.9, topK: -1, repetitionPenalty: 1.0,
        presencePenalty: 0, frequencyPenalty: 0, stop: '', enableThinking: true,
      },
    },
  ],
}


function loadProfilesFromStorage(storageKey: string, builtins: ChatProfile[]): ChatProfile[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return builtins
    const saved: ChatProfile[] = JSON.parse(raw)
    const builtinIds = new Set(builtins.map(p => p.id))
    const custom = saved.filter(p => !builtinIds.has(p.id))
    const mergedBuiltins = builtins.map(builtin => {
      const savedVersion = saved.find(s => s.id === builtin.id)
      if (savedVersion && (savedVersion as ChatProfile & { userModified?: boolean }).userModified) {
        return savedVersion
      }
      return builtin
    })
    const normalize = (p: ChatProfile): ChatProfile => ({
      ...p,
      params: { ...p.params, permanentRules: p.params.permanentRules ?? '' },
    })
    return [...mergedBuiltins.map(normalize), ...custom.map(normalize)]
  } catch {
    return builtins
  }
}

export function useProfiles(scope?: { mode: ProjectMode; projectId: string }) {
  const storageKey = scope ? `echohub:profiles:${scope.projectId}` : STORAGE_KEY
  const activeKey  = scope ? `echohub:active-profile:${scope.projectId}` : ACTIVE_KEY
  const builtins   = scope ? PROJECT_BUILTINS[scope.mode] : CHAT_BUILTINS
  const defaultId  = builtins[0].id

  const [profiles, setProfiles] = useState<ChatProfile[]>(() =>
    loadProfilesFromStorage(storageKey, builtins)
  )
  const [activeId, setActiveId] = useState<string>(
    () => localStorage.getItem(activeKey) ?? defaultId
  )

  const activeProfile = profiles.find(p => p.id === activeId) ?? profiles[0]

  const persistProfiles = useCallback((updated: ChatProfile[]): void => {
    localStorage.setItem(storageKey, JSON.stringify(updated))
  }, [storageKey])

  const selectProfile = useCallback((id: string): ChatParams => {
    setActiveId(id)
    localStorage.setItem(activeKey, id)
    return profiles.find(p => p.id === id)?.params ?? profiles[0].params
  }, [profiles, activeKey])

  const saveProfile = useCallback((id: string, name: string, params: ChatParams): void => {
    setProfiles(prev => {
      const exists = prev.find(p => p.id === id)
      const profile = { id, name, params, userModified: true } as ChatProfile & { userModified: boolean }
      const updated = exists
        ? prev.map(p => p.id === id ? profile : p)
        : [...prev, profile]
      persistProfiles(updated)
      return updated
    })
    setActiveId(id)
    localStorage.setItem(activeKey, id)
  }, [persistProfiles, activeKey])

  const deleteProfile = useCallback((id: string): void => {
    if (id === defaultId) return
    setProfiles(prev => {
      const updated = prev.filter(p => p.id !== id)
      persistProfiles(updated)
      return updated
    })
    if (activeId === id) {
      setActiveId(defaultId)
      localStorage.setItem(activeKey, defaultId)
    }
  }, [activeId, defaultId, persistProfiles, activeKey])

  return { profiles, activeId, activeProfile, selectProfile, saveProfile, deleteProfile }
}
