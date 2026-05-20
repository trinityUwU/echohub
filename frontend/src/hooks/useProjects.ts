import { useState, useCallback } from 'react'
import type { ProjectMode } from './useChatMode'

export interface Project {
  id: string
  name: string
  mode: ProjectMode
  description: string
  archived: boolean
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'echohub:projects'

function load(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Project[]) : []
  } catch {
    return []
  }
}

function save(projects: Project[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
  } catch { /* ignore */ }
}

export function useProjects(): {
  projects: Project[]
  createProject: (name: string, mode: ProjectMode, description?: string) => Project
  archiveProject: (id: string) => void
  unarchiveProject: (id: string) => void
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
} {
  const [projects, setProjects] = useState<Project[]>(load)

  const mutate = useCallback((updater: (prev: Project[]) => Project[]): void => {
    setProjects(prev => {
      const next = updater(prev)
      save(next)
      return next
    })
  }, [])

  const createProject = useCallback((name: string, mode: ProjectMode, description = ''): Project => {
    const project: Project = {
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      mode,
      description,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    mutate(prev => [project, ...prev])
    return project
  }, [mutate])

  const archiveProject = useCallback((id: string): void => {
    mutate(prev => prev.map(p => p.id === id ? { ...p, archived: true, updatedAt: Date.now() } : p))
  }, [mutate])

  const unarchiveProject = useCallback((id: string): void => {
    mutate(prev => prev.map(p => p.id === id ? { ...p, archived: false, updatedAt: Date.now() } : p))
  }, [mutate])

  const deleteProject = useCallback((id: string): void => {
    mutate(prev => prev.filter(p => p.id !== id))
  }, [mutate])

  const renameProject = useCallback((id: string, name: string): void => {
    mutate(prev => prev.map(p => p.id === id ? { ...p, name, updatedAt: Date.now() } : p))
  }, [mutate])

  return { projects, createProject, archiveProject, unarchiveProject, deleteProject, renameProject }
}
