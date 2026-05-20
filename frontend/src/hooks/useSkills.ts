import { useCallback, useEffect, useRef, useState } from 'react'
import { listSkills, listMcpServers, startMcp, stopMcp } from '@/api/client'
import type { CommunitySkill, McpStatus } from '@/api/client'
import { addToast } from '@/hooks/useToast'

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
  const [_rawCommunity, setRawCommunity] = useState<CommunitySkill[]>([])
  const rawCommunityRef = useRef<CommunitySkill[]>([])
  const [mcpStatuses, setMcpStatuses] = useState<Record<string, McpStatus>>({})

  const fetchMcpStatuses = useCallback((): void => {
    listMcpServers()
      .then(list => {
        const map: Record<string, McpStatus> = {}
        list.forEach(s => { map[s.skill_id] = s })
        setMcpStatuses(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const active = loadActiveIds()
    listSkills().then(data => {
      rawCommunityRef.current = data.community
      setRawCommunity(data.community)
      setCommunitySkills(data.community.map(communityToSkill))
      // Auto-start MCP servers that were active in previous session
      const mcpSkills = data.community.filter(s => s.is_mcp && active.has(s.id))
      if (mcpSkills.length === 0) return
      listMcpServers().then(statuses => {
        const runningIds = new Set(statuses.filter(s => s.status === 'running').map(s => s.skill_id))
        mcpSkills.forEach(s => {
          if (runningIds.has(s.id)) return
          startMcp(s.id)
            .then(() => {
              fetchMcpStatuses()
              addToast({ type: 'success', title: 'MCP server started', message: s.name })
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err)
              addToast({ type: 'error', title: `${s.name} failed to start`, message: msg })
            })
        })
      }).catch(() => {})
    }).catch(() => {})
    fetchMcpStatuses()
  }, [fetchMcpStatuses])

  const refresh = useCallback((): void => {
    listSkills().then(data => {
      rawCommunityRef.current = data.community
      setRawCommunity(data.community)
      setCommunitySkills(data.community.map(communityToSkill))
    }).catch(() => {})
    fetchMcpStatuses()
  }, [fetchMcpStatuses])

  const allSkills: Skill[] = [...NATIVE_SKILLS, ...communitySkills]

  const toggle = useCallback((id: string): void => {
    let enabling = false
    setActiveIds(prev => {
      const next = new Set(prev)
      enabling = !next.has(id)
      if (enabling) next.add(id)
      else next.delete(id)
      saveActiveIds(next)
      return next
    })
    // Auto-start/stop MCP server when toggling a community MCP skill
    const skill = rawCommunityRef.current.find(s => s.id === id)
    if (skill?.is_mcp) {
      if (enabling) {
        startMcp(id)
          .then(() => {
            fetchMcpStatuses()
            addToast({ type: 'success', title: 'MCP server started', message: skill.name })
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            addToast({
              type: 'error',
              title: 'MCP failed to start',
              message: msg,
              action: { label: 'View skill', onClick: () => { /* navigate handled by caller */ } },
            })
          })
      } else {
        stopMcp(id)
          .then(() => {
            fetchMcpStatuses()
            addToast({ type: 'info', title: 'MCP server stopped', message: skill.name })
          })
          .catch(() => {})
      }
    }
  }, [fetchMcpStatuses])

  const activeSkills = allSkills.filter(s => activeIds.has(s.id))
  const enabledTools = [...new Set(activeSkills.flatMap(s => s.tools))]
  const awarenessBlock = activeSkills.map(s => s.awareness).filter(Boolean).join('\n')
  const hasToolSkills = enabledTools.length > 0

  return { activeIds, allSkills, communitySkills, activeSkills, enabledTools, awarenessBlock, hasToolSkills, toggle, refresh, mcpStatuses }
}

// Legacy type alias kept for compat
export type SkillId = string
export type UseSkillsReturn = ReturnType<typeof useSkills>
