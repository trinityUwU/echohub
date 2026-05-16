import { useState } from 'react'
import { downloadModel } from '@/api/client'
import type { DownloadJob, GgufFile, ModelInfo } from '@/types'
import { Badge } from '@/components/shared/Badge'
import { Btn } from '@/components/shared/Btn'

interface ModelDetailPanelProps {
  model: ModelInfo
  vramTotalGb: number
  vramFreeGb: number
  job?: DownloadJob
  onClose: () => void
  onLoad: () => void
  onDownloaded: () => void
}

export function ModelDetailPanel({ model, vramFreeGb, job, onClose, onLoad, onDownloaded }: ModelDetailPanelProps): React.ReactElement {
  const [selectedGguf, setSelectedGguf] = useState<GgufFile | null>(model.gguf_files?.[1] ?? model.gguf_files?.[0] ?? null)
  const [downloading, setDownloading] = useState(false)

  const isDownloading = job?.state === 'running' || job?.state === 'pending'
  const vram = selectedGguf ? (selectedGguf.size_gb * 1.1) : (model.vram_estimate_gb ?? 0)
  const isOom = vram > vramFreeGb

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
    <div className="w-[340px] flex-shrink-0 bg-surface border-l border-border flex flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border">
        <h3 className="flex-1 text-sm font-semibold text-text-primary truncate">{model.name}</h3>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-secondary cursor-pointer transition-colors">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5">
        <div className="flex gap-1 flex-wrap">
          {model.quantization && <Badge variant="quant">{model.quantization.split('/')[0]}</Badge>}
          {model.capabilities.thinking && <Badge variant="think">thinking</Badge>}
          {model.capabilities.vision && <Badge variant="vision">vision</Badge>}
          {model.capabilities.code && <Badge variant="cap">code</Badge>}
          {model.capabilities.multilingual && <Badge variant="cap">multilingual</Badge>}
          {model.gated && <Badge variant="gated">gated</Badge>}
        </div>

        {model.description && <p className="text-sm text-text-secondary leading-relaxed">{model.description}</p>}

        <DetailSection title="Model Info">
          <DetailRow k="Author"       v={model.author ?? '—'} />
          <DetailRow k="Parameters"   v={model.params_billion ? `${model.params_billion}B` : '—'} />
          <DetailRow k="Context"      v={model.max_context_window?.toLocaleString('en') ?? '—'} />
          <DetailRow k="Architecture" v={model.arch_tag ?? '—'} />
          {model.downloads != null && <DetailRow k="Downloads" v={model.downloads.toLocaleString('en')} />}
          {model.likes != null && <DetailRow k="Likes" v={String(model.likes)} />}
          {model.last_modified && <DetailRow k="Updated" v={model.last_modified} />}
        </DetailSection>

        {model.gguf_files && model.gguf_files.length > 0 && (
          <DetailSection title="Select variant">
            <div className="flex flex-col gap-1.5">
              {model.gguf_files.map(f => (
                <GgufItem key={f.name} file={f} selected={selectedGguf?.name === f.name} onClick={() => setSelectedGguf(f)} />
              ))}
            </div>
          </DetailSection>
        )}

        {model.more_from_author && model.more_from_author.length > 0 && (
          <DetailSection title={`More from ${model.author}`}>
            {model.more_from_author.map(m => (
              <div key={m.id} className="flex justify-between items-center py-1.5 text-sm border-b border-border/50 last:border-b-0">
                <span className="text-text-secondary truncate">{m.id.split('/').pop()}</span>
                {m.downloads != null && <span className="text-text-muted text-xs">{(m.downloads / 1000).toFixed(0)}K ↓</span>}
              </div>
            ))}
          </DetailSection>
        )}
      </div>

      <div className="px-4 py-3.5 border-t border-border flex flex-col gap-2">
        <div className="flex justify-between text-xs text-text-muted">
          <span>{selectedGguf ? `${selectedGguf.variant} · ${selectedGguf.size_gb} GB` : model.size_gb ? `${model.size_gb} GB` : '—'}</span>
          {isOom && <span className="text-yellow">⚠ exceeds free VRAM ({vramFreeGb.toFixed(1)} GB)</span>}
        </div>
        {model.downloaded ? (
          <Btn variant="primary" onClick={onLoad} className="w-full justify-center">Load</Btn>
        ) : (
          <Btn variant="primary" onClick={handleDownload} disabled={downloading || isDownloading} className="w-full justify-center">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {isDownloading ? 'Downloading…' : `Download${selectedGguf ? ` ${selectedGguf.variant}` : ''}`}
          </Btn>
        )}
      </div>
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2">{title}</div>
      {children}
    </div>
  )
}

function DetailRow({ k, v }: { k: string; v: string }): React.ReactElement {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-white/4 last:border-b-0 text-sm">
      <span className="text-text-muted">{k}</span>
      <span className="text-text-primary font-mono text-xs">{v}</span>
    </div>
  )
}

function GgufItem({ file, selected, onClick }: { file: GgufFile; selected: boolean; onClick: () => void }): React.ReactElement {
  return (
    <button onClick={onClick}
      className={`flex items-center justify-between px-2.5 py-2 rounded-sm border cursor-pointer transition-colors text-left ${
        selected ? 'border-accent/40 bg-accent-dim' : 'bg-elevated border-border hover:border-border-hover'
      }`}
    >
      <div>
        <div className="text-sm font-semibold font-mono text-text-primary">{file.variant}</div>
        <div className="text-xs text-text-muted mt-0.5">
          {file.variant.startsWith('Q2') ? 'Smallest' : file.variant.startsWith('Q4') ? 'Recommended' : file.variant.startsWith('Q5') ? 'Higher fidelity' : 'Near-lossless'}
        </div>
      </div>
      <span className="text-sm text-text-muted">{file.size_gb} GB</span>
    </button>
  )
}
