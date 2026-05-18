import { useState, useEffect, useCallback } from 'react'
import type { EvalResult, FinetuneEval, GgufCandidate, GgufFileCandidate } from '@/types'
import { listEvals, findGguf, evalRunStreamUrl } from '@/api/client'

interface EvalPanelProps {
  profileId: string | null
  jobId: string | null
  selectedModelId: string | null
  onEvalDone: () => void
}

type PipelineStep = { label: string; done: boolean }

interface EvalRunState {
  running: boolean
  steps: PipelineStep[]
  progress: { current: number; total: number } | null
  error: string | null
}

const IDLE_RUN_STATE: EvalRunState = { running: false, steps: [], progress: null, error: null }

export function EvalPanel({ profileId, jobId, selectedModelId, onEvalDone }: EvalPanelProps): React.ReactElement {
  const [evals, setEvals] = useState<FinetuneEval[]>([])
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<GgufCandidate[] | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<GgufCandidate | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [runState, setRunState] = useState<EvalRunState>(IDLE_RUN_STATE)
  const [activeStage, setActiveStage] = useState<'before' | 'after' | null>(null)

  const loadEvals = useCallback(async (): Promise<void> => {
    if (!profileId) return
    try {
      const data = await listEvals({ profile_id: profileId })
      setEvals(data)
    } catch { /* ignore */ }
  }, [profileId])

  useEffect(() => { void loadEvals() }, [loadEvals])

  // Reset search when model changes
  useEffect(() => {
    setCandidates(null)
    setSelectedCandidate(null)
    setSelectedFile(null)
  }, [selectedModelId])

  const beforeEval = evals.find(e => e.stage === 'before') ?? null
  const afterEval = evals.find(e => e.stage === 'after') ?? null

  const handleFindGguf = async (): Promise<void> => {
    if (!selectedModelId) return
    setSearching(true)
    try {
      const result = await findGguf(selectedModelId)
      setCandidates(result.candidates)
      if (result.candidates.length > 0) {
        const top = result.candidates[0]
        setSelectedCandidate(top)
        setSelectedFile(top.recommended_file ?? null)
      }
    } catch { /* ignore */ } finally {
      setSearching(false)
    }
  }

  const handleRunEval = async (stage: 'before' | 'after'): Promise<void> => {
    if (!profileId || !selectedCandidate || !selectedFile) return
    setActiveStage(stage)
    setRunState({ running: true, steps: [], progress: null, error: null })

    try {
      const url = await evalRunStreamUrl()
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: profileId,
          job_id: jobId,
          stage,
          gguf_model_id: selectedCandidate.id,
          gguf_file: selectedFile,
          delete_after: true,
        }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      const processLines = (lines: string[]): boolean => {
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const d = JSON.parse(line.slice(6)) as Record<string, unknown>
            if (d.type === 'step') {
              setRunState(s => ({ ...s, steps: [...s.steps.map(x => ({ ...x, done: true })), { label: String(d.label), done: false }] }))
            } else if (d.type === 'progress') {
              setRunState(s => ({ ...s, progress: { current: Number(d.current), total: Number(d.total) } }))
            } else if (d.type === 'error') {
              setRunState(s => ({ ...s, running: false, error: String(d.text) }))
              return true
            } else if (d.type === 'done') {
              setRunState(s => ({ ...s, running: false, steps: s.steps.map(x => ({ ...x, done: true })) }))
              void loadEvals().then(() => onEvalDone())
              return true
            }
          } catch { /* skip */ }
        }
        return false
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const chunks = buf.split('\n\n')
        buf = chunks.pop() ?? ''
        if (processLines(chunks)) break
      }
    } catch (e) {
      setRunState(s => ({ ...s, running: false, error: e instanceof Error ? e.message : 'Unknown error' }))
    } finally {
      setActiveStage(null)
    }
  }

  if (!profileId) return <></>

  const canRun = !!selectedCandidate && !!selectedFile && !runState.running
  const modelSelected = !!selectedModelId

  return (
    <div className="border-t border-white/[0.06] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Eval</span>
      </div>

      {/* GGUF selector */}
      <GgufSelector
        modelSelected={modelSelected}
        searching={searching}
        candidates={candidates}
        selectedCandidate={selectedCandidate}
        selectedFile={selectedFile}
        onFindGguf={handleFindGguf}
        onSelectCandidate={(c) => {
          setSelectedCandidate(c)
          setSelectedFile(c.recommended_file ?? null)
        }}
        onSelectFile={setSelectedFile}
      />

      {/* Pipeline status */}
      {(runState.running || runState.steps.length > 0 || runState.error) && (
        <PipelineStatus state={runState} />
      )}

      {/* Before / After panels */}
      <div className="flex gap-3">
        <EvalStageCard
          label="Before"
          eval={beforeEval}
          canRun={canRun}
          running={activeStage === 'before'}
          onRun={() => void handleRunEval('before')}
        />
        <DeltaArrow before={beforeEval} after={afterEval} />
        <EvalStageCard
          label="After"
          eval={afterEval}
          canRun={canRun && jobId !== null}
          running={activeStage === 'after'}
          onRun={() => void handleRunEval('after')}
        />
      </div>

      {(beforeEval || afterEval) && (
        <EvalResultsExpanded before={beforeEval} after={afterEval} />
      )}
    </div>
  )
}

// ── GgufSelector ────────────────────────────────────────────────────────────

interface GgufSelectorProps {
  modelSelected: boolean
  searching: boolean
  candidates: GgufCandidate[] | null
  selectedCandidate: GgufCandidate | null
  selectedFile: string | null
  onFindGguf: () => void
  onSelectCandidate: (c: GgufCandidate) => void
  onSelectFile: (f: string) => void
}

function GgufSelector({ modelSelected, searching, candidates, selectedCandidate, selectedFile, onFindGguf, onSelectCandidate, onSelectFile }: GgufSelectorProps): React.ReactElement {
  if (!modelSelected) {
    return (
      <p className="text-xs text-text-muted/60">
        Select a model in the Models tab to run eval
      </p>
    )
  }

  if (candidates === null) {
    return (
      <button
        onClick={onFindGguf}
        disabled={searching}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded cursor-pointer transition-colors disabled:opacity-50"
      >
        {searching && <span className="w-3 h-3 border border-accent/40 border-t-accent rounded-full animate-spin" />}
        {searching ? 'Searching…' : 'Find GGUF for eval'}
      </button>
    )
  }

  if (candidates.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted/60">No GGUF found for this model</span>
        <button onClick={onFindGguf} className="text-xs text-accent cursor-pointer hover:text-accent/80">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-muted">GGUF repo:</span>
        {candidates.map(c => (
          <button
            key={c.id}
            onClick={() => onSelectCandidate(c)}
            className={`px-2 py-0.5 rounded text-xs cursor-pointer transition-colors ${
              selectedCandidate?.id === c.id
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-white/[0.04] text-text-muted hover:bg-white/[0.08] border border-white/[0.06]'
            }`}
          >
            {c.id.split('/')[1] ?? c.id}
            {c.same_author && <span className="ml-1 text-[10px] text-green-400/70">✓</span>}
          </button>
        ))}
        <button onClick={onFindGguf} disabled={searching} className="text-xs text-text-muted/60 hover:text-text-muted cursor-pointer">
          Refresh
        </button>
      </div>

      {selectedCandidate?.gguf_files && selectedCandidate.gguf_files.length > 0 && (
        <GgufFileList files={selectedCandidate.gguf_files} selected={selectedFile} onSelect={onSelectFile} />
      )}
    </div>
  )
}

// ── GgufFileList ────────────────────────────────────────────────────────────

function GgufFileList({ files, selected, onSelect }: {
  files: GgufFileCandidate[]
  selected: string | null
  onSelect: (f: string) => void
}): React.ReactElement {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-text-muted">File:</span>
      {files.map(f => (
        <button
          key={f.name}
          onClick={() => onSelect(f.name)}
          className={`px-2 py-0.5 rounded text-xs cursor-pointer transition-colors ${
            selected === f.name
              ? 'bg-accent/20 text-accent border border-accent/30'
              : 'bg-white/[0.04] text-text-muted hover:bg-white/[0.08] border border-white/[0.06]'
          }`}
        >
          {extractVariant(f.name)}
          <span className="ml-1 text-[10px] opacity-60">{f.size_gb}GB</span>
        </button>
      ))}
    </div>
  )
}

function extractVariant(filename: string): string {
  const m = filename.toUpperCase().match(/(Q\d[_\-]?K[_\-]?[MS]?|Q\d[_\-]\d|Q\d[_\-]K|Q\d|F16|BF16|IQ\d[_\-]\w+)/)
  return m ? m[1].replace('-', '_') : filename.split('.')[0].slice(-12)
}

// ── PipelineStatus ──────────────────────────────────────────────────────────

function PipelineStatus({ state }: { state: EvalRunState }): React.ReactElement {
  return (
    <div className="bg-overlay border border-white/[0.06] rounded-md p-3 space-y-1.5">
      {state.steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          {s.done
            ? <span className="text-green-400 w-3">✓</span>
            : <span className="w-3 h-3 border border-accent/40 border-t-accent rounded-full animate-spin" />
          }
          <span className={s.done ? 'text-text-muted' : 'text-text-primary'}>{s.label}</span>
        </div>
      ))}
      {state.progress && (
        <div>
          <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-200"
              style={{ width: `${(state.progress.current / state.progress.total) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-text-muted mt-0.5 block">
            {state.progress.current}/{state.progress.total} prompts
          </span>
        </div>
      )}
      {state.error && (
        <p className="text-xs text-red-400">{state.error}</p>
      )}
    </div>
  )
}

// ── EvalStageCard ────────────────────────────────────────────────────────────

interface EvalStageCardProps {
  label: string
  eval: FinetuneEval | null
  canRun: boolean
  running: boolean
  onRun: () => void
}

function EvalStageCard({ label, eval: e, canRun, running, onRun }: EvalStageCardProps): React.ReactElement {
  const scoreColor = e?.score_avg != null
    ? e.score_avg >= 70 ? 'text-green-400' : e.score_avg >= 50 ? 'text-amber-400' : 'text-red-400'
    : 'text-text-muted'

  return (
    <div className="flex-1 bg-surface border border-white/[0.06] rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{label}</span>
        {e && <span className={`text-lg font-bold tabular-nums ${scoreColor}`}>{e.score_avg?.toFixed(1) ?? '—'}</span>}
      </div>

      {e ? (
        <div className="text-xs text-text-muted">
          {e.results.length} prompts · {new Date(e.created_at).toLocaleDateString()}
        </div>
      ) : running ? (
        <span className="text-xs text-accent">Running…</span>
      ) : (
        <button
          disabled={!canRun}
          onClick={onRun}
          className="text-xs text-accent hover:text-accent/80 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          Run {label.toLowerCase()} eval
        </button>
      )}
    </div>
  )
}

// ── DeltaArrow ───────────────────────────────────────────────────────────────

function DeltaArrow({ before, after }: { before: FinetuneEval | null; after: FinetuneEval | null }): React.ReactElement {
  if (!before || !after) {
    return <div className="flex items-center text-text-muted text-lg px-1">→</div>
  }
  const delta = (after.score_avg ?? 0) - (before.score_avg ?? 0)
  const color = delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-text-muted'
  return (
    <div className={`flex flex-col items-center justify-center px-1 ${color}`}>
      <span className="text-sm">→</span>
      <span className="text-xs font-bold tabular-nums">{delta > 0 ? '+' : ''}{delta.toFixed(1)}</span>
    </div>
  )
}

// ── EvalResultsExpanded ───────────────────────────────────────────────────────

function EvalResultsExpanded({ before, after }: {
  before: FinetuneEval | null; after: FinetuneEval | null
}): React.ReactElement {
  const [expanded, setExpanded] = useState(true)
  const results = before?.results ?? after?.results ?? []
  const afterMap = Object.fromEntries((after?.results ?? []).map(r => [r.prompt_id, r]))
  const hasComparison = !!before && !!after

  return (
    <div className="border border-white/[0.06] rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] cursor-pointer transition-colors"
      >
        <span className="text-[10px] text-text-muted uppercase tracking-widest font-medium">
          {hasComparison ? 'Before / After comparison' : before ? 'Before eval results' : 'After eval results'}
          <span className="ml-2 text-text-muted/50">({results.length} prompts)</span>
        </span>
        <svg className={`w-3 h-3 text-text-muted/40 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {expanded && (
        <div className="divide-y divide-white/[0.04]">
          {results.map((br, i) => {
            const ar = afterMap[br.prompt_id]
            return (
              <PromptRow
                key={br.prompt_id ?? i}
                prompt={br.prompt}
                before={before ? br : null}
                after={after ? (ar ?? null) : null}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function PromptRow({ prompt, before, after }: {
  prompt: string; before: EvalResult | null; after: EvalResult | null
}): React.ReactElement {
  const hasBoth = !!before && !!after
  return (
    <div className="px-3 py-3 text-xs">
      <p className="text-text-muted font-medium mb-2 leading-relaxed">{prompt}</p>
      <div className={hasBoth ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-2'}>
        {before && (
          <ResponseBlock
            label="Before"
            response={before.response}
            score={before.score}
            scoreColor="text-amber-400"
          />
        )}
        {after && (
          <ResponseBlock
            label="After"
            response={after.response}
            score={after.score}
            scoreColor="text-green-400"
          />
        )}
      </div>
    </div>
  )
}

function ResponseBlock({ label, response, score, scoreColor }: {
  label: string; response: string; score: number | null; scoreColor: string
}): React.ReactElement {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-text-muted/60 uppercase tracking-wider text-[10px]">{label}</span>
        {score != null && <span className={`text-[10px] font-bold ${scoreColor}`}>{score.toFixed(0)}</span>}
      </div>
      <p className="text-text-primary leading-relaxed whitespace-pre-wrap bg-white/[0.02] rounded px-2 py-1.5">
        {response || <span className="text-text-muted/40 italic">No response</span>}
      </p>
    </div>
  )
}
