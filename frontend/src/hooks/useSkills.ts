import { useCallback, useState } from 'react'

export type SkillId = 'web-search' | 'code-runner' | 'file-system' | 'calculator'

export interface Skill {
  id: SkillId
  name: string
  tools: string[]
  awareness: string
  description: string
}

export const SKILLS: Skill[] = [
  {
    id: 'web-search',
    name: 'Web Search',
    tools: ['fetch_url', 'web_search'],
    awareness: 'Web search: use web_search to find URLs, fetch_url to read pages. Always search before fetching.',
    description: 'Fetch URLs and search the web',
  },
  {
    id: 'code-runner',
    name: 'Code Runner',
    tools: ['run_command'],
    awareness: 'Code runner: use run_command to execute shell commands, run scripts, validate code.',
    description: 'Execute shell commands',
  },
  {
    id: 'file-system',
    name: 'File System',
    tools: ['create_file', 'read_file', 'edit_file', 'delete_file', 'list_files', 'get_workspace_info'],
    awareness: 'File system: use create_file, read_file, edit_file, delete_file, list_files to manage workspace files.',
    description: 'Manage workspace files',
  },
  {
    id: 'calculator',
    name: 'Calculator',
    tools: ['run_command'],
    awareness: 'Calculator: for precise math, run python3 -c "print(expression)" via run_command.',
    description: 'Precise calculations via Python',
  },
]

const STORAGE_KEY = 'echohub:active-skills'

function loadFromStorage(): Set<SkillId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as string[]
    return new Set(parsed.filter(id => SKILLS.some(s => s.id === id)) as SkillId[])
  } catch {
    return new Set()
  }
}

export function useSkills() {
  const [activeIds, setActiveIds] = useState<Set<SkillId>>(loadFromStorage)

  const toggle = useCallback((id: SkillId): void => {
    setActiveIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  const activeSkills = SKILLS.filter(s => activeIds.has(s.id))
  const enabledTools = [...new Set(activeSkills.flatMap(s => s.tools))]
  const awarenessBlock = activeSkills.map(s => s.awareness).join('\n')
  const hasToolSkills = enabledTools.length > 0

  return { activeIds, activeSkills, enabledTools, awarenessBlock, hasToolSkills, toggle }
}

export type UseSkillsReturn = ReturnType<typeof useSkills>
