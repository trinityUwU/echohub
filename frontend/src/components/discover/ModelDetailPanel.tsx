import { useEffect, useState } from 'react'
import { downloadModel, getModelReadme, checkModelCompatibility } from '@/api/client'
import type { DownloadJob, GgufFile, ModelInfo } from '@/types'
import { Badge } from '@/components/shared/Badge'
import { Btn } from '@/components/shared/Btn'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type Tab = 'info' | 'readme'

interface ModelDetailPanelProps {
  model: ModelInfo
  loading?: boolean
  vramTotalGb: number
  vramFreeGb: number
  job?: DownloadJob
  isFavorite?: boolean
  onClose: () => void
  onLoad: () => void
  onDownloaded: () => void
  onToggleFavorite?: (model: ModelInfo) => void
  onSelectRelated?: (id: string) => void
}

export function ModelDetailPanel({ model, loading, vramFreeGb, job, isFavorite, onClose, onLoad, onDownloaded, onToggleFavorite, onSelectRelated }: ModelDetailPanelProps): React.ReactElement {
  const [tab, setTab] = useState<Tab>('info')
  const [selectedGguf, setSelectedGguf] = useState<GgufFile | null>(
    model.gguf_files?.find(f => f.variant.includes('Q4_K_M')) ?? model.gguf_files?.[0] ?? null
  )
  const [downloading, setDownloading] = useState(false)
  const [readme, setReadme] = useState<string | null>(null)
  const [readmeLoading, setReadmeLoading] = useState(false)
  const [compat, setCompat] = useState<{
    compatible_vllm: boolean | null; compatible_llama: boolean | null
    vllm_issues: string[]; recommendation: string
    required_vllm_version?: string | null; installed_vllm_versions?: string[]
  } | null>(null)
  const [installingEngine, setInstallingEngine] = useState(false)

  useEffect(() => {
    setCompat(null)
    checkModelCompatibility(model.id)
      .then(r => setCompat(r))
      .catch(() => {})
  }, [model.id])

  const isDownloading = job?.state === 'running' || job?.state === 'pending'
  const dlPct = job ? Math.round((job.progress ?? 0) * 100) : 0
  const vramEst = selectedGguf ? selectedGguf.size_gb * 1.1 : (model.vram_estimate_gb ?? 0)
  const isOom = vramEst > vramFreeGb

  useEffect(() => {
    if (tab === 'readme' && readme === null && !readmeLoading) {
      setReadmeLoading(true)
      getModelReadme(model.id)
        .then(r => setReadme(r.content ?? '*No README available*'))
        .catch(() => setReadme('*Failed to load README*'))
        .finally(() => setReadmeLoading(false))
    }
  }, [tab, model.id])

  const handleDownload = async (): Promise<void> => {
    setDownloading(true)
    try {
      await downloadModel({ model_id: model.id, gguf_file: selectedGguf?.name })
      onDownloaded()
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="w-[420px] flex-shrink-0 bg-surface border-l border-border flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="px-5 pt-4 pb-3 border-b border-border flex-shrink-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-text-primary leading-snug break-words">{model.name}</h2>
            <span className="text-xs text-text-muted">{model.author}</span>
          </div>
          <div className="flex gap-1 flex-shrink-0 mt-0.5">
            {onToggleFavorite && (
              <button onClick={() => onToggleFavorite(model)} title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                className={`w-7 h-7 flex items-center justify-center rounded-sm hover:bg-overlay transition-colors cursor-pointer ${isFavorite ? 'text-yellow' : 'text-text-muted hover:text-yellow'}`}>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
            )}
            <a href={`https://huggingface.co/${model.id}`} target="_blank" rel="noopener noreferrer"
              title="Open on Hugging Face"
              className="w-7 h-7 flex items-center justify-center rounded-sm hover:bg-overlay text-text-muted hover:text-text-secondary transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-sm hover:bg-overlay text-text-muted hover:text-text-secondary transition-colors cursor-pointer">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Key stats row */}
        <div className="flex gap-3 text-xs text-text-muted mt-2 mb-3">
          {model.params_billion && <StatChip type="params" val={`${model.params_billion}B`} />}
          {model.max_context_window && <StatChip type="ctx" val={fmtCtx(model.max_context_window)} />}
          {model.vram_estimate_gb && <StatChip type="vram" val={`~${model.vram_estimate_gb} GB`} />}
          {model.downloads != null && <StatChip type="downloads" val={fmtNum(model.downloads)} />}
          {model.likes != null && <StatChip type="likes" val={String(model.likes)} />}
        </div>

        {/* Badges */}
        <div className="flex gap-1 flex-wrap">
          {model.quantization && <Badge variant="quant">{model.quantization.split('/')[0]}</Badge>}
          {model.capabilities.thinking && <Badge variant="think">thinking</Badge>}
          {model.capabilities.vision && <Badge variant="vision">vision</Badge>}
          {model.capabilities.code && <Badge variant="cap">code</Badge>}
          {model.capabilities.multilingual && <Badge variant="cap">multilingual</Badge>}
          {model.gated && <Badge variant="gated">gated</Badge>}
          {model.downloaded && !model.loaded && <Badge variant="dl">downloaded</Badge>}
          {model.loaded && <Badge variant="loaded">loaded</Badge>}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-border flex-shrink-0">
        {(['info', 'readme'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-widest cursor-pointer transition-colors ${
              tab === t ? 'text-accent border-b-2 border-accent' : 'text-text-muted hover:text-text-secondary'
            }`}>
            {t === 'info' ? 'Info' : 'README'}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'info' && (
          loading
            ? <div className="flex items-center justify-center h-24 text-text-muted text-sm animate-pulse">Loading details…</div>
            : <InfoTab model={model} selectedGguf={selectedGguf} onSelectGguf={setSelectedGguf} vramFreeGb={vramFreeGb} onSelectRelated={onSelectRelated} compat={compat} installingEngine={installingEngine} onInstallEngine={() => setInstallingEngine(true)} />
        )}
        {tab === 'readme' && <ReadmeTab content={readme} loading={readmeLoading} />}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-3 border-t border-border flex-shrink-0 flex flex-col gap-2">
        {isDownloading && (
          <div>
            <div className="flex justify-between text-xs text-text-muted mb-1.5">
              <span>{selectedGguf?.variant ?? 'Downloading'}…</span>
              <span className="font-mono">{job?.downloaded_gb.toFixed(2)} / {job?.total_gb?.toFixed(2) ?? '?'} GB · {dlPct}%</span>
            </div>
            <div className="h-1 bg-overlay rounded-sm overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${dlPct}%` }} />
            </div>
          </div>
        )}
        {!isDownloading && selectedGguf && (
          <div className="flex justify-between text-xs text-text-muted">
            <span className="font-mono">{selectedGguf.variant} · {selectedGguf.size_gb} GB</span>
            {isOom
              ? <span className="flex items-center gap-1 text-yellow"><WarnIcon />exceeds free VRAM</span>
              : <span className="flex items-center gap-1 text-green"><CheckIcon />fits in VRAM</span>}
          </div>
        )}
        {model.downloaded ? (
          <Btn variant="primary" onClick={onLoad} className="w-full justify-center">
            Load model
          </Btn>
        ) : (
          <Btn variant="primary" onClick={handleDownload} disabled={downloading || isDownloading} className="w-full justify-center">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {isDownloading ? `${dlPct}%` : `Download${selectedGguf ? ` ${selectedGguf.variant}` : ''}`}
          </Btn>
        )}
      </div>
    </div>
  )
}

type ChipType = 'params' | 'ctx' | 'vram' | 'downloads' | 'likes'

function StatChip({ type, val }: { type: ChipType; val: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-1 bg-elevated border border-border rounded px-1.5 py-0.5 text-text-secondary">
      <ChipIcon type={type} />
      <span>{val}</span>
    </span>
  )
}

function ChipIcon({ type }: { type: ChipType }): React.ReactElement {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (type === 'params') return <svg className="w-3 h-3" viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
  if (type === 'ctx') return <svg className="w-3 h-3" viewBox="0 0 24 24" {...p}><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
  if (type === 'vram') return <svg className="w-3 h-3" viewBox="0 0 24 24" {...p}><rect x="2" y="7" width="20" height="10" rx="1"/><path d="M6 7V5M10 7V5M14 7V5M18 7V5"/></svg>
  if (type === 'downloads') return <DownIcon />
  return <svg className="w-3 h-3" viewBox="0 0 24 24" {...p}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
}

function DownIcon(): React.ReactElement {
  return <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
}

function CheckIcon(): React.ReactElement {
  return <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
}

function WarnIcon(): React.ReactElement {
  return <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
}

type CompatResult = {
  compatible_vllm: boolean | null; compatible_llama: boolean | null
  vllm_issues: string[]; recommendation: string
  required_vllm_version?: string | null; installed_vllm_versions?: string[]
} | null

function InfoTab({ model, selectedGguf, onSelectGguf, vramFreeGb, onSelectRelated, compat, installingEngine, onInstallEngine }: {
  model: ModelInfo; selectedGguf: GgufFile | null
  onSelectGguf: (f: GgufFile) => void; vramFreeGb: number
  onSelectRelated?: (id: string) => void
  compat?: CompatResult
  installingEngine?: boolean
  onInstallEngine?: () => void
}): React.ReactElement {
  return (
    <div className="p-4 flex flex-col gap-5">

      {/* Compatibility banner */}
      {compat && (
        <CompatBanner compat={compat} installing={installingEngine ?? false} onInstall={onInstallEngine ?? (() => {})} />
      )}

      {model.description && (
        <p className="text-sm text-text-secondary leading-relaxed line-clamp-4 overflow-hidden">{model.description}</p>
      )}

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {model.arch_tag && <MetaItem label="Architecture" value={model.arch_tag} />}
        {model.pipeline_tag && <MetaItem label="Task" value={model.pipeline_tag} />}
        {model.quantization && <MetaItem label="Quantization" value={model.quantization} />}
        {model.last_modified && <MetaItem label="Updated" value={model.last_modified} />}
      </div>

      {/* GGUF variants */}
      {model.gguf_files && model.gguf_files.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2">
            Select variant
          </div>
          <div className="flex flex-col gap-1.5">
            {model.gguf_files.map(f => {
              const vramEst = f.size_gb * 1.1
              const fits = vramEst <= vramFreeGb
              return (
                <button key={f.name} onClick={() => onSelectGguf(f)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-sm border cursor-pointer transition-colors text-left ${
                    selectedGguf?.name === f.name
                      ? 'border-accent/40 bg-accent-dim'
                      : 'bg-elevated border-border hover:border-border-hover'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold font-mono text-text-primary">{f.variant}</div>
                    <div className="text-xs text-text-muted mt-0.5 truncate">{qualityLabel(f.variant)}</div>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <div className="text-sm font-mono text-text-secondary">{f.size_gb} GB</div>
                    <div className={`text-xs mt-0.5 font-medium ${fits ? 'text-green' : 'text-yellow'}`}>
                      {fits ? <><CheckIcon />{vramEst.toFixed(1)} GB</> : <><WarnIcon />{vramEst.toFixed(1)} GB</>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* More from author */}
      {model.more_from_author && model.more_from_author.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2">
            More from {model.author}
          </div>
          <div className="flex flex-col">
            {model.more_from_author.map(m => (
              <button key={m.id}
                onClick={() => onSelectRelated ? onSelectRelated(m.id) : undefined}
                className="flex justify-between items-center py-1.5 border-b border-border/40 last:border-0 hover:text-text-primary transition-colors cursor-pointer text-left w-full">
                <span className="text-sm text-text-secondary truncate">{m.id.split('/').pop()}</span>
                {m.downloads != null && (
                  <span className="text-xs text-text-muted ml-2 flex-shrink-0"><span className="flex items-center gap-1"><DownIcon />{fmtNum(m.downloads)}</span></span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ReadmeTab({ content, loading }: { content: string | null; loading: boolean }): React.ReactElement {
  if (loading) return (
    <div className="flex items-center justify-center h-32 text-text-muted text-sm animate-pulse">
      Loading README…
    </div>
  )
  if (!content) return (
    <div className="p-4 text-text-muted text-sm">No README available</div>
  )
  return (
    <div className="p-4 prose prose-invert prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{
          img: () => null,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{children}</a>
          ),
          code({ className, children, ...props }) {
            const isBlock = className?.includes('language-')
            return isBlock
              ? <pre className="bg-[#0d0d10] border border-border rounded-sm p-3 font-mono text-xs overflow-x-auto my-2 leading-relaxed"><code className={className} {...props}>{children}</code></pre>
              : <code className="font-mono text-xs bg-white/7 px-1 py-0.5 rounded-sm" {...props}>{children}</code>
          },
        }}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

function CompatBanner({ compat, installing, onInstall }: {
  compat: NonNullable<CompatResult>; installing: boolean; onInstall: () => void
}): React.ReactElement {
  const ok = compat.compatible_vllm || compat.compatible_llama
  const issues = compat.vllm_issues ?? []
  const required = compat.required_vllm_version
  const installed = compat.installed_vllm_versions ?? []
  const needsInstall = required && required !== 'future' && !installed.includes(required)

  if (ok && issues.length === 0) {
    return (
      <div className="flex items-start gap-2 bg-green/8 border border-green/20 rounded-sm px-3 py-2 text-xs text-green">
        <svg className="w-3.5 h-3.5 flex-shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Compatible with {compat.compatible_vllm ? 'vLLM' : 'llama-cpp'}
      </div>
    )
  }

  // Determine what action is available
  const isGguf = compat.compatible_llama === true
  const action = needsInstall
    ? 'install'
    : required === 'future'
      ? 'no_engine'
      : isGguf
        ? 'use_llama'
        : 'no_action'

  const actionLabel: Record<string, string> = {
    install: `Install vLLM ${required}`,
    no_engine: 'No compatible engine yet',
    use_llama: 'Load with llama-cpp (GGUF)',
    no_action: 'Check Settings → Engines',
  }

  const displayIssues = issues.length > 0 ? issues : ['This model may have compatibility issues with the current engine version.']
  const displayRec = compat.recommendation || (isGguf ? 'This is a GGUF model — it can be loaded with llama-cpp regardless of vLLM compatibility.' : 'Check Settings → Engines to manage installed versions.')

  return (
    <div className="flex flex-col gap-2 bg-yellow/6 border border-yellow/20 rounded-sm px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-yellow">
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Compatibility warning
        </div>
        {action === 'install' && (
          <button onClick={onInstall} disabled={installing}
            className="text-2xs px-2.5 py-1 rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-50 text-white cursor-pointer transition-colors flex-shrink-0 font-medium">
            {installing ? 'Installing…' : actionLabel.install}
          </button>
        )}
        {action !== 'install' && (
          <span className={`text-2xs px-2 py-0.5 rounded-sm border flex-shrink-0 ${
            action === 'no_engine' ? 'border-red/30 text-red/70' :
            action === 'use_llama' ? 'border-green/30 text-green' :
            'border-yellow/30 text-yellow/70'
          }`}>{actionLabel[action]}</span>
        )}
      </div>
      {displayIssues.map((issue, i) => (
        <div key={i} className="text-xs text-yellow/80 leading-relaxed">{issue}</div>
      ))}
      <div className="text-xs text-text-muted border-t border-yellow/15 pt-1.5 leading-relaxed">{displayRec}</div>
    </div>
  )
}

function MetaItem({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <div className="text-xs text-text-muted mb-0.5">{label}</div>
      <div className="text-sm text-text-primary font-medium truncate">{value}</div>
    </div>
  )
}

function qualityLabel(variant: string): string {
  const v = variant.toLowerCase()
  if (v.includes('q2')) return 'Smallest · lowest quality'
  if (v.includes('q4_k_m')) return 'Recommended · best balance'
  if (v.includes('q4')) return 'Good balance'
  if (v.includes('q5')) return 'Higher fidelity'
  if (v.includes('q8')) return 'Near-lossless'
  if (v.includes('f16') || v.includes('fp16')) return 'Full precision'
  return ''
}

const fmtNum = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1000 ? `${(n / 1000).toFixed(0)}K`
  : String(n)

const fmtCtx = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(0)}K ctx` : `${n} ctx`
