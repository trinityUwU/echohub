import { useState, useMemo, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import type { ModelInfo, ModelCapabilities } from '@/types'

interface Props {
  models: ModelInfo[]
  onSelect: (id: string, manual: boolean) => void
  onClose: () => void
}

type SortKey = 'recency' | 'size' | 'downloaded'

// ─── Inline SVG icons ──────────────────────────────────────────────────────

const EyeIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
)

const BrainIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
)

const TerminalIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
)

const GlobeIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
  </svg>
)

const WrenchIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

// ─── Capability icons (no bg, just color) ──────────────────────────────────

const CAP_ICON_META: Record<keyof ModelCapabilities, { icon: React.ComponentType<{ className?: string }>; color: string; title: string }> = {
  vision:      { icon: EyeIcon,      color: 'text-cyan-400',   title: 'Vision' },
  thinking:    { icon: BrainIcon,    color: 'text-violet-400', title: 'Reasoning' },
  code:        { icon: TerminalIcon, color: 'text-green-400',  title: 'Code' },
  multilingual:{ icon: GlobeIcon,    color: 'text-orange-400', title: 'Multilingual' },
  tools:       { icon: WrenchIcon,   color: 'text-yellow-400', title: 'Tool Use' },
}

// ─── Architecture color mapping ────────────────────────────────────────────

function getArchColor(arch: string): string {
  const lower = arch.toLowerCase()
  if (lower.includes('qwen'))     return 'bg-red-500/20 text-red-300 border-red-500/30'
  if (lower.includes('mistral'))  return 'bg-blue-500/20 text-blue-300 border-blue-500/30'
  if (lower.includes('llama'))    return 'bg-orange-500/20 text-orange-300 border-orange-500/30'
  if (lower.includes('gemma'))    return 'bg-green-500/20 text-green-300 border-green-500/30'
  if (lower.includes('deepseek')) return 'bg-violet-500/20 text-violet-300 border-violet-500/30'
  if (lower.includes('phi'))      return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
  if (lower.includes('falcon'))   return 'bg-teal-500/20 text-teal-300 border-teal-500/30'
  if (lower.includes('yi'))       return 'bg-pink-500/20 text-pink-300 border-pink-500/30'
  return 'bg-surface-3 text-muted border-border'
}

function inferArch(modelId: string): string {
  const id = modelId.toLowerCase()
  if (id.includes('qwen'))     return 'qwen'
  if (id.includes('mistral'))  return 'mistral'
  if (id.includes('llama'))    return 'llama'
  if (id.includes('gemma'))    return 'gemma'
  if (id.includes('deepseek')) return 'deepseek'
  if (id.includes('phi'))      return 'phi'
  if (id.includes('falcon'))   return 'falcon'
  if (id.includes('yi'))       return 'yi'
  return modelId.split('/')[0]?.slice(0, 8) ?? '—'
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ModelPickerModal({ models, onSelect, onClose }: Props): React.ReactElement {
  const [query, setQuery]         = useState('')
  const [sort, setSort]           = useState<SortKey>('recency')
  const [manualConfig, setManual] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    const list = q
      ? models.filter(m =>
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.quantization?.toLowerCase().includes(q)
        )
      : [...models]

    switch (sort) {
      case 'size':       return list.sort((a, b) => (b.size_gb ?? 0) - (a.size_gb ?? 0))
      case 'downloaded': return list.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
      default:           return list
    }
  }, [models, query, sort])

  const handleSelect = (id: string): void => {
    onSelect(id, manualConfig)
    onClose()
  }

  const SORT_LABELS: Record<SortKey, string> = {
    recency:    'Recency',
    size:       'Size',
    downloaded: 'Downloaded',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        className="relative w-full max-w-2xl max-h-[600px] bg-surface-1 border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <svg className="w-4 h-4 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search models…"
            className="flex-1 bg-transparent text-sm text-white placeholder-muted outline-none"
          />
          <button onClick={onClose} className="text-muted hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Column header + sort */}
        <div className="flex items-center px-4 py-2 border-b border-border shrink-0">
          <span className="flex-1 text-xs font-semibold text-white tracking-wide">Your Models</span>
          <div className="flex gap-1">
            {(Object.keys(SORT_LABELS) as SortKey[]).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                  sort === s
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'text-muted hover:text-white'
                }`}
              >
                {SORT_LABELS[s]}{sort === s ? ' ↓' : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Model list */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {filtered.length === 0 && (
            <p className="text-sm text-muted text-center py-12">No models match "{query}"</p>
          )}
          {filtered.map(m => {
            const arch = inferArch(m.id)
            const archColor = getArchColor(m.id)
            const activeCaps = (Object.keys(CAP_ICON_META) as Array<keyof ModelCapabilities>).filter(k => m.capabilities[k])

            return (
              <button
                key={m.id}
                onClick={() => handleSelect(m.id)}
                className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-surface-2 transition-colors border-b border-border/40 last:border-0 text-left group"
              >
                {/* Name + author */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium truncate leading-tight">{m.name}</div>
                  {m.author && (
                    <div className="text-xs text-muted truncate leading-tight mt-0.5">{m.author}</div>
                  )}
                </div>

                {/* Capability icons — no bg, just color */}
                {activeCaps.length > 0 && (
                  <div className="flex items-center gap-1 shrink-0">
                    {activeCaps.map(cap => {
                      const meta = CAP_ICON_META[cap]
                      const Icon = meta.icon
                      return (
                        <div
                          key={cap}
                          className="w-6 h-6 rounded-md bg-surface-2 flex items-center justify-center"
                          title={meta.title}
                        >
                          <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Params */}
                {m.params_billion != null && (
                  <span className="text-xs text-muted shrink-0 w-8 text-right tabular-nums">
                    {m.params_billion}B
                  </span>
                )}

                {/* Architecture badge */}
                <span className={`text-xs px-1.5 py-0.5 rounded border font-mono shrink-0 ${archColor}`}>
                  {arch}
                </span>

                {/* Quantization badge */}
                {m.quantization && (
                  <span className={`text-xs px-1.5 py-0.5 rounded border font-mono shrink-0 ${
                    m.quantization === 'AWQ'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : m.quantization === 'GPTQ'
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
                      : 'bg-surface-3 text-muted border-border'
                  }`}>
                    {m.quantization}
                  </span>
                )}

                {/* Size */}
                {m.size_gb != null && (
                  <span className="text-xs text-muted shrink-0 w-14 text-right tabular-nums">
                    {m.size_gb} GB
                  </span>
                )}

                <svg
                  className="w-4 h-4 text-muted/40 group-hover:text-muted transition-colors shrink-0"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )
          })}
        </div>

        {/* Footer — manual config toggle */}
        <div className="shrink-0 px-4 py-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted">Manually choose model load parameters</span>
          <button
            role="switch"
            aria-checked={manualConfig}
            onClick={() => setManual(v => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none ${
              manualConfig ? 'bg-accent' : 'bg-surface-3'
            }`}
          >
            <motion.span
              className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
              animate={{ x: manualConfig ? 16 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </button>
        </div>
      </motion.div>
    </div>
  )
}
