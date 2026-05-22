import { useState, useEffect, useCallback } from 'react'
import { apiRequest, apiUpload } from '@/api/base'

export interface ContextFile {
  id: string
  project_id: string
  filename: string
  size: number
  created_at: number
}

export interface ProjectSource {
  id: string
  project_id: string
  label: string
  url: string | null
  source_type: 'url' | 'file'
  created_at: number
}

interface UseContextFilesReturn {
  files: ContextFile[]
  loading: boolean
  upload: (file: File) => Promise<void>
  remove: (id: string) => Promise<void>
}

interface UseProjectSourcesReturn {
  sources: ProjectSource[]
  loading: boolean
  addUrl: (label: string, url: string) => Promise<void>
  upload: (file: File) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useContextFiles(projectId: string): UseContextFilesReturn {
  const [files, setFiles] = useState<ContextFile[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const data = await apiRequest<ContextFile[]>(`/projects/${projectId}/context-files`)
      setFiles(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])

  const upload = useCallback(async (file: File): Promise<void> => {
    const fd = new FormData()
    fd.append('file', file)
    await apiUpload<ContextFile>(`/projects/${projectId}/context-files`, fd)
    await refresh()
  }, [projectId, refresh])

  const remove = useCallback(async (id: string): Promise<void> => {
    await apiRequest(`/projects/${projectId}/context-files/${id}`, { method: 'DELETE' })
    setFiles(prev => prev.filter(f => f.id !== id))
  }, [projectId])

  return { files, loading, upload, remove }
}

export function useProjectSources(projectId: string): UseProjectSourcesReturn {
  const [sources, setSources] = useState<ProjectSource[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const data = await apiRequest<ProjectSource[]>(`/projects/${projectId}/sources`)
      setSources(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])

  const addUrl = useCallback(async (label: string, url: string): Promise<void> => {
    await apiRequest(`/projects/${projectId}/sources`, {
      method: 'POST',
      body: JSON.stringify({ label, url, content: '', source_type: 'url' }),
    })
    await refresh()
  }, [projectId, refresh])

  const upload = useCallback(async (file: File): Promise<void> => {
    const fd = new FormData()
    fd.append('file', file)
    await apiUpload<ProjectSource>(`/projects/${projectId}/sources/upload`, fd)
    await refresh()
  }, [projectId, refresh])

  const remove = useCallback(async (id: string): Promise<void> => {
    await apiRequest(`/projects/${projectId}/sources/${id}`, { method: 'DELETE' })
    setSources(prev => prev.filter(s => s.id !== id))
  }, [projectId])

  return { sources, loading, addUrl, upload, remove }
}
