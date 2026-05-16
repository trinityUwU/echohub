import { useEffect, useState } from 'react'
import { downloadModel, getModelReadme } from '@/api/client'
import type { DownloadJob, GgufFile, ModelInfo } from '@/types'
import { Badge } from '@/components/shared/Badge'
import { Btn } from '@/components/shared/Btn'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type Tab = 'info' | 'readme'

interface ModelDetailPanelProps {
  model: ModelInfo
  vramTotalGb: number
  vramFreeGb: number
  job?: DownloadJob
  onClose: () => void
  onLoad: () => void
  onDownloaded: () => void
}

const HF_BASE = 'https://huggingface.co'

export function ModelDetailPanel({ model, vramFreeGb, job, onClose, onLoad, onDownloaded }: ModelDetailPanelProps): React.ReactElement {
  const [tab, setTab] = useState<Tab>('info')
  const [selectedGguf, setSelectedGguf] = useState<GgufFile | null>(
    model.gguf_files?.find(f => f.variant.includes('Q4_K_M')) ?? model.gguf_files?.[0] ?? null
  )
  const [downloading, setDownloading] = useState(false)
  const [readme, setReadme] = useState<string | null>(null)
  const [readmeLoading, setReadmeLoading] = useState(false)

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
    } catch {
      // error handled upstream
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="w-[480px] flex-shrink-0 bg-surface border-l border-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-text-primary leading-tight break-all">{model.name}</h3>
            <div className="text-xs text-text-muted mt-0.5">{model.author}</div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <a href={`${HF_BASE}/${model.id}`} target="_blank" rel="noopener noreferrer"
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-secondary cursor-pointer transition-colors"
              title="View on Hugging Face">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
            <button onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-secondary cursor-pointer transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
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

      {/* Tabs */}
      <div className="flex border-b border-border flex-shrink-0">
        {(['info', 'readme'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-semibold uppercase tracking-widest cursor-pointer transition-colors ${
              tab === t ? 'text-accent border-b-2 border-accent' : 'text-text-muted hover:text-text-secondary'
            }`}>
            {t === 'info' ? 'Model Info' : 'README'}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'info' && <InfoTab model={model} selectedGguf={selectedGguf} onSelectGguf={setSelectedGguf} vramFreeGb={vramFreeGb} />}
        {tab === 'readme' && <ReadmeTab content={readme} loading={readmeLoading} />}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border flex-shrink-0 flex flex-col gap-2">
        {isDownloading && (
          <div>
            <div className="flex justify-between text-xs text-text-muted mb-1">
              <span>Downloading {selectedGguf?.variant ?? ''}…</span>
              <span className="font-mono">{job?.downloaded_gb.toFixed(2)} / {job?.total_gb?.toFixed(2) ?? '?'} GB ({dlPct}%)</span>
            </div>
            <div className="h-1 bg-overlay rounded-sm overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${dlPct}%` }} />
            </div>
          </div>
        )}
        <div className="flex justify-between text-xs text-text-muted">
          <span>{selectedGguf ? `${selectedGguf.variant} · ${selectedGguf.size_gb} GB` : model.size_gb ? `${model.size_gb.toFixed(2)} GB` : '—'}</span>
          {isOom && <span className="text-yellow">⚠ exceeds free VRAM ({vramFreeGb.toFixed(1)} GB)</span>}
        </div>
        {model.downloaded ? (
          <Btn variant="primary" onClick={onLoad} className="w-full justify-center">Load</Btn>
        ) : (
          <Btn variant="primary" onClick={handleDownload} disabled={downloading || isDownloading} className="w-full justify-center">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {isDownloading ? `Downloading… ${dlPct}%` : `Download${selectedGguf ? ` ${selectedGguf.variant}` : ''}`}
          </Btn>
        )}
      </div>
    </div>
  )
}

function InfoTab({ model, selectedGguf, onSelectGguf, vramFreeGb }: {
  model: ModelInfo; selectedGguf: GgufFile | null
  onSelectGguf: (f: GgufFile) => void; vramFreeGb: number
}): React.ReactElement {
  return (
    <div className="p-4 flex flex-col gap-4">
      {model.description && (
        <p className="text-sm text-text-secondary leading-relaxed">{model.description}</p>
      )}

      <Section title="Model Info">
        <Row k="Author"       v={model.author ?? '—'} />
        <Row k="Parameters"   v={model.params_billion ? `${model.params_billion}B` : '—'} />
        <Row k="Context"      v={model.max_context_window?.toLocaleString('en') ?? '—'} />
        <Row k="Architecture" v={model.arch_tag ?? '—'} />
        <Row k="Pipeline"     v={model.pipeline_tag ?? '—'} />
        <Row k="Quantization" v={model.quantization ?? '—'} />
        {model.vram_estimate_gb && <Row k="VRAM estimate" v={`~${model.vram_estimate_gb} GB`} />}
        {model.downloads != null && <Row k="Downloads" v={model.downloads.toLocaleString('en')} />}
        {model.likes != null && <Row k="Likes" v={String(model.likes)} />}
        {model.last_modified && <Row k="Last updated" v={model.last_modified} />}
        <Row k="HuggingFace" v="" link={`https://huggingface.co/${model.id}`} />
      </Section>

      {model.gguf_files && model.gguf_files.length > 0 && (
        <Section title="GGUF variants">
          <div className="flex flex-col gap-1.5">
            {model.gguf_files.map(f => {
              const vramEst = f.size_gb * 1.1
              const fits = vramEst <= vramFreeGb
              return (
                <button key={f.name} onClick={() => onSelectGguf(f)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-sm border cursor-pointer transition-colors text-left ${
                    selectedGguf?.name === f.name ? 'border-accent/40 bg-accent-dim' : 'bg-elevated border-border hover:border-border-hover'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold font-mono text-text-primary">{f.variant}</div>
                    <div className="text-xs text-text-muted mt-0.5 truncate">{f.name}</div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <div className="text-sm text-text-secondary font-mono">{f.size_gb} GB</div>
                    <div className={`text-xs mt-0.5 ${fits ? 'text-green' : 'text-yellow'}`}>
                      ~{vramEst.toFixed(1)} GB VRAM {fits ? '✓' : '⚠'}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </Section>
      )}

      {model.more_from_author && model.more_from_author.length > 0 && (
        <Section title={`More from ${model.author}`}>
          {model.more_from_author.map(m => (
            <div key={m.id} className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-b-0 text-sm">
              <span className="text-text-secondary truncate">{m.id.split('/').pop()}</span>
              {m.downloads != null && <span className="text-text-muted text-xs">{(m.downloads / 1000).toFixed(0)}K ↓</span>}
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}

function ReadmeTab({ content, loading }: { content: string | null; loading: boolean }): React.ReactElement {
  if (loading) return (
    <div className="flex items-center justify-center h-32 text-text-muted text-sm">Loading README…</div>
  )
  if (!content) return (
    <div className="p-4 text-text-muted text-sm">No README available</div>
  )
  return (
    <div className="p-4 prose prose-invert prose-sm max-w-none text-text-secondary">
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{
          img: () => null, // skip images
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{children}</a>
          ),
          code({ className, children, ...props }) {
            const isBlock = className?.includes('language-')
            return isBlock
              ? <pre className="bg-[#0d0d10] border border-border rounded-sm p-3 font-mono text-xs overflow-x-auto my-2"><code className={className} {...props}>{children}</code></pre>
              : <code className="font-mono text-xs bg-white/7 px-1 py-0.5 rounded-sm" {...props}>{children}</code>
          },
        }}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2">{title}</div>
      {children}
    </div>
  )
}

function Row({ k, v, link }: { k: string; v: string; link?: string }): React.ReactElement {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-white/4 last:border-b-0 text-sm">
      <span className="text-text-muted">{k}</span>
      {link
        ? <a href={link} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline text-xs font-mono">{link.replace('https://', '')}</a>
        : <span className="text-text-primary font-mono text-xs">{v}</span>
      }
    </div>
  )
}
