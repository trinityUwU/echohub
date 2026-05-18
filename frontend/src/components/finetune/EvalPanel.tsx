import { useState, useEffect, useCallback } from 'react'
import type { EvalPrompt, EvalResult, FinetuneEval } from '@/types'
import { listEvals, initEval, submitEval } from '@/api/client'
import { apiUrl } from '@/api/base'

interface EvalPanelProps {
  profileId: string | null
  jobId: string | null
  loadedModel: { id: string; path?: string } | null
  onEvalDone: () => void
}

export function EvalPanel({ profileId, jobId, loadedModel, onEvalDone }: EvalPanelProps): React.ReactElement {
  const [evals, setEvals] = useState<FinetuneEval[]>([])
  const [running, setRunning] = useState<'before' | 'after' | null>(null)
  const [runningProgress, setRunningProgress] = useState(0)

  const isGguf = checkIsGguf(loadedModel)

  const loadEvals = useCallback(async (): Promise<void> => {
    if (!profileId) return
    try {
      const data = await listEvals({ profile_id: profileId })
      setEvals(data)
    } catch { /* ignore */ }
  }, [profileId])

  useEffect(() => { loadEvals() }, [loadEvals])

  const beforeEval = evals.find(e => e.stage === 'before') ?? null
  const afterEval = evals.find(e => e.stage === 'after') ?? null

  const runEval = async (stage: 'before' | 'after'): Promise<void> => {
    if (!profileId || !loadedModel) return
    setRunning(stage)
    setRunningProgress(0)

    try {
      const ready = await initEval({
        profile_id: profileId,
        stage,
        model_id: loadedModel.id,
        model_path: loadedModel.path ?? loadedModel.id,
        job_id: jobId ?? undefined,
      })

      const results = await runPrompts(ready.prompts, progress => setRunningProgress(progress))

      await submitEval({
        profile_id: profileId,
        stage,
        model_id: loadedModel.id,
        model_path: loadedModel.path ?? loadedModel.id,
        job_id: jobId ?? undefined,
        results,
      })

      await loadEvals()
      onEvalDone()
    } catch { /* ignore */ } finally {
      setRunning(null)
      setRunningProgress(0)
    }
  }

  if (!profileId) return <></>

  return (
    <div className="border-t border-white/[0.06] p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Eval</span>
        {!isGguf && loadedModel && (
          <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
            Load a GGUF model to run eval. BF16 will damage your GPU.
          </span>
        )}
      </div>

      <div className="flex gap-4">
        <EvalStageCard
          label="Before"
          eval={beforeEval}
          canRun={!!loadedModel && isGguf && running === null}
          running={running === 'before'}
          progress={running === 'before' ? runningProgress : 0}
          onRun={() => runEval('before')}
        />
        <ComparisonArrow before={beforeEval} after={afterEval} />
        <EvalStageCard
          label="After"
          eval={afterEval}
          canRun={!!loadedModel && isGguf && running === null && jobId !== null}
          running={running === 'after'}
          progress={running === 'after' ? runningProgress : 0}
          onRun={() => runEval('after')}
        />
      </div>

      {beforeEval && afterEval && (
        <EvalComparison before={beforeEval} after={afterEval} />
      )}
    </div>
  )
}

// ── EvalStageCard ──────────────────────────────────────────────────────────

interface EvalStageCardProps {
  label: string
  eval: FinetuneEval | null
  canRun: boolean
  running: boolean
  progress: number
  onRun: () => void
}

function EvalStageCard({ label, eval: e, canRun, running, progress, onRun }: EvalStageCardProps): React.ReactElement {
  const scoreColor = e?.score_avg !== null && e?.score_avg !== undefined
    ? e.score_avg >= 70 ? 'text-green-400' : e.score_avg >= 50 ? 'text-amber-400' : 'text-red-400'
    : 'text-text-muted'

  return (
    <div className="flex-1 bg-surface border border-white/[0.06] rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{label}</span>
        {e && <span className={`text-lg font-bold tabular-nums ${scoreColor}`}>
          {e.score_avg?.toFixed(1) ?? '—'}
        </span>}
      </div>

      {e ? (
        <div className="text-xs text-text-muted">
          {e.results.length} prompts · {new Date(e.created_at).toLocaleDateString()}
        </div>
      ) : running ? (
        <div>
          <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden mb-1">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="text-xs text-text-muted">Running... {Math.round(progress * 100)}%</span>
        </div>
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

// ── ComparisonArrow ────────────────────────────────────────────────────────

function ComparisonArrow({ before, after }: {
  before: FinetuneEval | null; after: FinetuneEval | null
}): React.ReactElement {
  if (!before || !after) {
    return <div className="flex items-center text-text-muted text-lg px-1">→</div>
  }

  const delta = (after.score_avg ?? 0) - (before.score_avg ?? 0)
  const color = delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-text-muted'

  return (
    <div className={`flex flex-col items-center justify-center px-1 ${color}`}>
      <span className="text-sm">→</span>
      <span className="text-xs font-bold tabular-nums">
        {delta > 0 ? '+' : ''}{delta.toFixed(1)}
      </span>
    </div>
  )
}

// ── EvalComparison ─────────────────────────────────────────────────────────

function EvalComparison({ before, after }: {
  before: FinetuneEval; after: FinetuneEval
}): React.ReactElement {
  const afterByPromptId = Object.fromEntries(after.results.map(r => [r.prompt_id, r]))

  return (
    <div className="mt-4 space-y-3">
      <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block">Per-prompt comparison</span>
      {before.results.map(br => {
        const ar = afterByPromptId[br.prompt_id]
        if (!ar) return null
        return <PromptComparisonRow key={br.prompt_id} before={br} after={ar} />
      })}
    </div>
  )
}

function PromptComparisonRow({ before, after }: {
  before: EvalResult; after: EvalResult
}): React.ReactElement {
  return (
    <div className="bg-surface border border-white/[0.06] rounded-md p-3 text-xs">
      <p className="text-text-secondary mb-2 font-medium">{before.prompt}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-text-muted block mb-1">Before
            {before.score !== null && <span className="ml-1 text-amber-400">{before.score.toFixed(0)}</span>}
          </span>
          <p className="text-text-primary leading-relaxed whitespace-pre-wrap">{before.response}</p>
        </div>
        <div>
          <span className="text-text-muted block mb-1">After
            {after.score !== null && <span className="ml-1 text-green-400">{after.score.toFixed(0)}</span>}
          </span>
          <p className="text-text-primary leading-relaxed whitespace-pre-wrap">{after.response}</p>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function checkIsGguf(model: { id: string; path?: string } | null): boolean {
  if (!model) return false
  return model.id.toLowerCase().includes('gguf') || (model.path?.endsWith('.gguf') ?? false)
}

async function runPrompts(
  prompts: EvalPrompt[],
  onProgress: (p: number) => void,
): Promise<EvalResult[]> {
  const results: EvalResult[] = []

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i]
    const response = await runSinglePrompt(p.prompt)
    results.push({ prompt_id: p.id, prompt: p.prompt, response, score: null })
    onProgress((i + 1) / prompts.length)
  }

  return results
}

async function runSinglePrompt(prompt: string): Promise<string> {
  try {
    const url = await apiUrl('/inference/chat')
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        max_tokens: 512,
      }),
    })
    if (!res.ok) return ''
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data?.choices?.[0]?.message?.content ?? ''
  } catch {
    return ''
  }
}
