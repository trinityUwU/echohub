import { useState, useEffect, useRef } from 'react'
import { apiRequest } from '@/api/base'

interface BenchProfile {
  id: number; name: string; description: string; prompt: string
  max_tokens: number; temperature: number; builtin: number
}

interface BenchResult {
  profile_id: number; profile_name: string; tok_per_sec: number
  ttft_ms: number | null; decode_ms: number; total_ms: number
  tokens_generated: number; [key: string]: unknown
}

interface RunState {
  running: boolean
  currentProfile: string | null
  currentIndex: number
  total: number
  results: BenchResult[]
  done: boolean
  error: string | null
}

interface Props {
  onClose: () => void
  onResults: (results: BenchResult[]) => void
}

export function RunBenchmarkModal({ onClose, onResults }: Props): React.ReactElement {
  const [profiles, setProfiles] = useState<BenchProfile[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [state, setState] = useState<RunState>({
    running: false, currentProfile: null, currentIndex: 0,
    total: 0, results: [], done: false, error: null,
  })
  const [showCreate, setShowCreate] = useState(false)
  const [newProfile, setNewProfile] = useState({ name: '', description: '', prompt: '', max_tokens: 200, temperature: 0.0 })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    apiRequest<BenchProfile[]>('/settings/benchmark-profiles')
      .then(p => {
        setProfiles(p)
        // Select all builtins by default
        setSelected(new Set(p.filter(x => x.builtin).map(x => x.id)))
      })
      .catch(() => {})
      .finally(() => setLoadingProfiles(false))
  }, [])

  const toggle = (id: number): void => {
    setSelected(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const run = async (): Promise<void> => {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    setState({ running: true, currentProfile: null, currentIndex: 0, total: ids.length, results: [], done: false, error: null })

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const base = await import('@/api/base').then(m => m.apiUrl('/inference/benchmark/run-profiles'))
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_ids: ids }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (value) buf += dec.decode(value, { stream: !done })
        const blocks = buf.split('\n\n')
        buf = done ? '' : (blocks.pop() ?? '')

        for (const block of blocks) {
          if (!block.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(block.slice(6))
            if (ev.type === 'start') {
              setState(s => ({ ...s, currentProfile: ev.profile_name, currentIndex: ev.index }))
            } else if (ev.type === 'result') {
              setState(s => ({ ...s, results: [...s.results, ev.result] }))
            } else if (ev.type === 'error') {
              setState(s => ({ ...s, error: `${ev.profile_id}: ${ev.error}` }))
            } else if (ev.type === 'done') {
              setState(s => ({ ...s, running: false, done: true, currentProfile: null }))
            }
          } catch { /* ignore parse errors */ }
        }
        if (done) break
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setState(s => ({ ...s, running: false, error: String(e) }))
      }
    }
  }

  const cancel = (): void => {
    abortRef.current?.abort()
    setState(s => ({ ...s, running: false, currentProfile: null }))
  }

  const createProfile = async (): Promise<void> => {
    if (!newProfile.name.trim() || !newProfile.prompt.trim()) return
    try {
      const p = await apiRequest<BenchProfile>('/settings/benchmark-profiles', {
        method: 'POST',
        body: JSON.stringify(newProfile),
      })
      setProfiles(prev => [...prev, p])
      setSelected(prev => new Set([...prev, p.id]))
      setShowCreate(false)
      setNewProfile({ name: '', description: '', prompt: '', max_tokens: 200, temperature: 0.0 })
    } catch (e) { console.error(e) }
  }

  const deleteProfile = async (id: number): Promise<void> => {
    await apiRequest(`/settings/benchmark-profiles/${id}`, { method: 'DELETE' }).catch(() => {})
    setProfiles(prev => prev.filter(p => p.id !== id))
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  const finish = (): void => {
    onResults(state.results)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget && !state.running) onClose() }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !state.running && onClose()} />
      <div className="relative bg-[#0f0f12] rounded-xl w-full max-w-[540px] max-h-[90vh] overflow-y-auto shadow-2xl mx-4 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/6">
          <div>
            <div className="text-sm font-semibold text-white">Run Benchmark</div>
            <div className="text-xs text-white/40 mt-0.5">Select profiles to run — results saved automatically</div>
          </div>
          {!state.running && (
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/6 text-white/40 hover:text-white/80 transition-colors cursor-pointer">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>

        <div className="flex-1 p-5 flex flex-col gap-5">

          {/* Profile list */}
          {!state.running && !state.done && (
            <div className="flex flex-col gap-2">
              {loadingProfiles && <div className="text-xs text-white/40 animate-pulse">Loading profiles…</div>}
              {profiles.map(p => (
                <ProfileRow key={p.id} profile={p} selected={selected.has(p.id)}
                  onToggle={() => toggle(p.id)}
                  onDelete={p.builtin ? undefined : () => deleteProfile(p.id)} />
              ))}
              <button onClick={() => setShowCreate(v => !v)}
                className="flex items-center gap-2 text-xs text-white/40 hover:text-white/70 cursor-pointer transition-colors mt-1">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create custom profile
              </button>

              {showCreate && (
                <div className="bg-white/[0.025] rounded-xl p-4 flex flex-col gap-3 mt-1">
                  <div className="text-xs font-semibold text-white/70 uppercase tracking-widest">New profile</div>
                  <input value={newProfile.name} onChange={e => setNewProfile(s => ({ ...s, name: e.target.value }))}
                    placeholder="Name" className="bg-white/5 rounded-lg px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:bg-white/8 transition-colors" />
                  <input value={newProfile.description} onChange={e => setNewProfile(s => ({ ...s, description: e.target.value }))}
                    placeholder="Description (optional)" className="bg-white/5 rounded-lg px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:bg-white/8 transition-colors" />
                  <textarea value={newProfile.prompt} onChange={e => setNewProfile(s => ({ ...s, prompt: e.target.value }))}
                    placeholder="Prompt" rows={3} className="bg-white/5 rounded-lg px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 resize-none focus:bg-white/8 transition-colors" />
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <div className="text-xs text-white/40 mb-1">Max tokens</div>
                      <input type="number" value={newProfile.max_tokens} onChange={e => setNewProfile(s => ({ ...s, max_tokens: parseInt(e.target.value) || 200 }))}
                        className="w-full bg-white/5 rounded-lg px-3 py-2 text-sm text-white outline-none focus:bg-white/8 transition-colors" />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs text-white/40 mb-1">Temperature</div>
                      <input type="number" step="0.1" min="0" max="2" value={newProfile.temperature} onChange={e => setNewProfile(s => ({ ...s, temperature: parseFloat(e.target.value) || 0 }))}
                        className="w-full bg-white/5 rounded-lg px-3 py-2 text-sm text-white outline-none focus:bg-white/8 transition-colors" />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-white/40 hover:text-white/70 cursor-pointer transition-colors">Cancel</button>
                    <button onClick={createProfile}
                      disabled={!newProfile.name.trim() || !newProfile.prompt.trim()}
                      className="px-4 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg cursor-pointer transition-colors font-medium">
                      Create
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Running state */}
          {state.running && (
            <div className="flex flex-col gap-4">
              <div className="text-xs text-white/50">
                Running {state.currentIndex + 1} / {state.total} — <span className="text-white/80 font-medium">{state.currentProfile}</span>
              </div>
              <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
                <div className="h-full bg-accent transition-all duration-300 rounded-full"
                  style={{ width: `${((state.currentIndex) / state.total) * 100}%` }} />
              </div>
              {state.results.map(r => (
                <ResultPreview key={r.profile_id} result={r} />
              ))}
              <div className="flex items-center gap-2 text-xs text-white/40 animate-pulse">
                <span className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                Generating…
              </div>
            </div>
          )}

          {/* Done */}
          {state.done && (
            <div className="flex flex-col gap-3">
              <div className="text-xs text-white/50">
                <span className="text-green font-semibold">Done</span> — {state.results.length} profiles completed
              </div>
              {state.results.map(r => (
                <ResultPreview key={r.profile_id} result={r} />
              ))}
            </div>
          )}

          {state.error && (
            <div className="text-xs text-red bg-red/8 rounded-lg px-3 py-2">{state.error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2">
          {!state.running && !state.done && (
            <>
              <button onClick={onClose} className="flex-1 py-2.5 text-sm text-white/40 hover:text-white/70 cursor-pointer transition-colors">Cancel</button>
              <button onClick={run} disabled={selected.size === 0}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Run {selected.size} profile{selected.size !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {state.running && (
            <button onClick={cancel}
              className="flex-1 py-2.5 text-sm text-red hover:bg-red/10 rounded-lg cursor-pointer transition-colors border border-red/20">
              Cancel run
            </button>
          )}
          {state.done && (
            <button onClick={finish}
              className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg cursor-pointer transition-colors">
              View results →
            </button>
          )}
        </div>

      </div>
    </div>
  )
}

function ProfileRow({ profile: p, selected, onToggle, onDelete }: {
  profile: BenchProfile; selected: boolean; onToggle: () => void; onDelete?: () => void
}): React.ReactElement {
  return (
    <div onClick={onToggle}
      className={`flex items-start gap-3 p-3.5 rounded-xl cursor-pointer transition-colors ${
        selected ? 'bg-accent/10' : 'bg-white/[0.025] hover:bg-white/[0.04]'
      }`}>
      <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
        selected ? 'bg-accent' : 'bg-white/10'
      }`}>
        {selected && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-white">{p.name}</span>
          {p.builtin ? (
            <span className="text-2xs text-accent/70 bg-accent/10 px-1.5 py-px rounded">builtin</span>
          ) : (
            <span className="text-2xs text-white/30 bg-white/5 px-1.5 py-px rounded">custom</span>
          )}
          <span className="text-2xs text-white/30 ml-auto">{p.max_tokens} tok</span>
        </div>
        <div className="text-xs text-white/40">{p.description}</div>
      </div>
      {onDelete && (
        <button onClick={e => { e.stopPropagation(); onDelete() }}
          className="w-6 h-6 flex items-center justify-center text-white/20 hover:text-red transition-colors cursor-pointer flex-shrink-0">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      )}
    </div>
  )
}

function ResultPreview({ result: r }: { result: BenchResult }): React.ReactElement {
  const speedCol = r.tok_per_sec >= 60 ? 'text-green' : r.tok_per_sec >= 30 ? 'text-yellow' : 'text-red'
  return (
    <div className="flex items-center justify-between bg-white/[0.025] rounded-xl px-4 py-3">
      <div>
        <div className="text-sm font-medium text-white">{r.profile_name}</div>
        <div className="text-xs text-white/40 mt-0.5">
          {r.tokens_generated} tokens · {r.ttft_ms ? `${r.ttft_ms}ms TTFT` : '—'}
        </div>
      </div>
      <div className="text-right">
        <div className={`text-xl font-black font-mono ${speedCol}`}>{r.tok_per_sec}</div>
        <div className="text-2xs text-white/30">tok/s</div>
      </div>
    </div>
  )
}
