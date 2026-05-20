import { useCallback, useEffect, useState } from 'react'
import { listSkills } from '@/api/client'
import type { CommunitySkill } from '@/api/client'

export interface Skill {
  id: string
  name: string
  tools: string[]
  awareness: string
  description: string
  type: 'native' | 'community'
  path?: string
}

export const NATIVE_SKILLS: Skill[] = [
  {
    id: 'web-search', type: 'native',
    name: 'Web Search',
    tools: ['fetch_url', 'web_search'],
    awareness: 'Web search: use web_search to find URLs, fetch_url to read pages. Always search before fetching.',
    description: 'Fetch URLs and search the web',
  },
  {
    id: 'code-runner', type: 'native',
    name: 'Code Runner',
    tools: ['run_command'],
    awareness: 'Code runner: use run_command to execute shell commands, run scripts, validate code.',
    description: 'Execute shell commands',
  },
  {
    id: 'file-system', type: 'native',
    name: 'File System',
    tools: ['create_file', 'read_file', 'edit_file', 'delete_file', 'list_files', 'get_workspace_info'],
    awareness: 'File system: use create_file, read_file, edit_file, delete_file, list_files to manage workspace files.',
    description: 'Manage workspace files',
  },
  {
    id: 'calculator', type: 'native',
    name: 'Calculator',
    tools: ['run_command'],
    awareness: 'Calculator: for precise math, run python3 -c "print(expression)" via run_command.',
    description: 'Precise calculations via Python',
  },
]

const STORAGE_KEY = 'echohub:active-skills'

function loadActiveIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function saveActiveIds(ids: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
}

function communityToSkill(c: CommunitySkill): Skill {
  return {
    id: c.id,
    name: c.name,
    type: 'community',
    tools: c.tools ?? [],
    awareness: c.awareness ?? '',
    description: c.description,
    path: c.path,
  }
}

export function useSkills() {
  const [activeIds, setActiveIds] = useState<Set<string>>(loadActiveIds)
  const [communitySkills, setCommunitySkills] = useState<Skill[]>([])

  useEffect(() => {
    listSkills()
      .then(data => setCommunitySkills(data.community.map(communityToSkill)))
      .catch(() => {})
  }, [])

  const refresh = useCallback((): void => {
    listSkills()
      .then(data => setCommunitySkills(data.community.map(communityToSkill)))
      .catch(() => {})
  }, [])

  const allSkills: Skill[] = [...NATIVE_SKILLS, ...communitySkills]

  const toggle = useCallback((id: string): void => {
    setActiveIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveActiveIds(next)
      return next
    })
  }, [])

  const activeSkills = allSkills.filter(s => activeIds.has(s.id))
  const enabledTools = [...new Set(activeSkills.flatMap(s => s.tools))]
  const awarenessBlock = activeSkills.map(s => s.awareness).filter(Boolean).join('\n')
  const hasToolSkills = enabledTools.length > 0

  return { activeIds, allSkills, communitySkills, activeSkills, enabledTools, awarenessBlock, hasToolSkills, toggle, refresh }
}

// Legacy type alias kept for compat
export type SkillId = string
export type UseSkillsReturn = ReturnType<typeof useSkills>
