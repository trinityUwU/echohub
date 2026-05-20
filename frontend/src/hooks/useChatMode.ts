import { useState } from 'react'

export type ChatView = 'chat' | 'projects'
export type ProjectMode = 'dev' | 'docs' | 'research'

interface UseChatModeReturn {
  view: ChatView
  mode: ProjectMode
  setView: (v: ChatView) => void
  setMode: (m: ProjectMode) => void
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

  const setView = (v: ChatView): void => {
    localStorage.setItem('echohub:chatView', v)
    setViewState(v)
  }

  const setMode = (m: ProjectMode): void => {
    localStorage.setItem('echohub:projectMode', m)
    setModeState(m)
  }

  return { view, mode, setView, setMode }
}
