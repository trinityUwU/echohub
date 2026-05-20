import { useState } from 'react'
import type { Project } from './useProjects'

export type ChatView = 'chat' | 'projects'
export type ProjectMode = 'dev' | 'docs' | 'research'

interface UseChatModeReturn {
  view: ChatView
  mode: ProjectMode
  activeProject: Project | null
  setView: (v: ChatView) => void
  setMode: (m: ProjectMode) => void
  openProject: (project: Project) => void
  closeProject: () => void
}

function loadView(): ChatView {
  const stored = localStorage.getItem('echohub:chatView')
  return stored === 'projects' ? 'projects' : 'chat'
}

function loadMode(): ProjectMode {
  const stored = localStorage.getItem('echohub:projectMode')
  if (stored === 'docs' || stored === 'research') return stored
  return 'dev'
}

export function useChatMode(): UseChatModeReturn {
  const [view, setViewState] = useState<ChatView>(loadView)
  const [mode, setModeState] = useState<ProjectMode>(loadMode)
  const [activeProject, setActiveProject] = useState<Project | null>(null)

  const setView = (v: ChatView): void => {
    localStorage.setItem('echohub:chatView', v)
    setViewState(v)
    if (v === 'chat') setActiveProject(null)
  }

  const setMode = (m: ProjectMode): void => {
    localStorage.setItem('echohub:projectMode', m)
    setModeState(m)
  }

  const openProject = (project: Project): void => {
    setActiveProject(project)
    setModeState(project.mode)
  }

  const closeProject = (): void => {
    setActiveProject(null)
  }

  return { view, mode, activeProject, setView, setMode, openProject, closeProject }
}
