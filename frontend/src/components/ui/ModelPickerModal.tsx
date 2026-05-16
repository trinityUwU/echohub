import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import type { ModelInfo } from '@/types'

interface Props {
  models: ModelInfo[]
  onSelect: (id: string, manual: boolean) => void
  onClose: () => void
}

const ARCH_COLORS: Record<string, { bg: string; text: string }> = {
  qwen: { bg: 'bg-red-900/40', text: 'text-red-300' },
  mistral: { bg: 'bg-blue-900/40', text: 'text-blue-300' },
  llama: { bg: 'bg-orange-900/40', text: 'text-orange-300' },
  gemma: { bg: 'bg-green-900/40', text: 'text-green-300' },
  deepseek: { bg: 'bg-violet-900/40', text: 'text-violet-300' },
  phi: { bg: 'bg-cyan-900/40', text: 'text-cyan-300' },
}

function detectArch(id: string): string {
  const l = id.toLowerCase()
  if (l.includes('qwen')) return 'qwen'
  if (l.includes('mistral') || l.includes('mixtral')) return 'mistral'
  if (l.includes('llama')) return 'llama'
  if (l.includes('gemma')) return 'gemma'
  if (l.includes('deepseek')) return 'deepseek'
  if (l.includes('phi')) return 'phi'
  return ''
}

export function ModelPickerModal({ models, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recency' | 'size'>('recency')
  const [manualConfig, setManualConfig] = useState(false)

  const filtered = useMemo(() => {
    let list = models.filter(m => !query || m.id.toLowerCase().includes(query.toLowerCase()))
    if (sort === 'size') list = [...list].sort((a, b) => (a.size_gb ?? 0) - (b.size_gb ?? 0))
    return list
  }, [models, query, sort])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-2xl max-h-[580px] flex flex-col bg-surface-1 border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-white/[0.05]">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search models…"
            className="bg-surface-2 w-full rounded-lg px-3 py-2 text-sm placeholder:text-muted/40 border-0 focus:outline-none focus:ring-1 focus:ring-accent/30 text-white"
          />
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.05]">
          <span className="text-2xs font-semibold uppercase tracking-widest text-muted/50">Your Models</span>
          <div className="flex gap-1">
            {(['recency', 'size'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`text-2xs px-2 py-0.5 rounded ${sort === s ? 'bg-surface-3 text-white' : 'text-muted/50 hover:text-white'}`}
              >
                {s === 'recency' ? 'Recency' : 'Size'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.map(m => {
            const arch = detectArch(m.id)
            const archStyle = ARCH_COLORS[arch]
            return (
              <button
                key={m.id}
                onClick={() => { onSelect(m.id, manualConfig); onClose() }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60 transition-colors border-b border-white/[0.03] last:border-0"
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${archStyle?.bg ?? 'bg-surface-3'}`}>
                  <span className={`text-2xs font-mono font-semibold ${archStyle?.text ?? 'text-muted/60'}`}>
                    {m.name.slice(0, 2)}
                  </span>
                </div>
                <span className="text-sm truncate flex-1 text-left">{m.name}</span>
                {arch && archStyle && (
                  <span className={`text-2xs font-mono px-1.5 py-0 rounded ${archStyle.bg}/80 ${archStyle.text} leading-4`}>{arch}</span>
                )}
                {m.quantization && (
                  <span className="text-2xs font-mono text-muted/50">{m.quantization}</span>
                )}
                {m.params_billion && (
                  <span className="text-2xs text-muted/40">{m.params_billion}B</span>
                )}
                {m.size_gb && (
                  <span className="text-2xs text-muted/40">{m.size_gb.toFixed(1)} GB</span>
                )}
                <svg className="w-3 h-3 text-muted/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3 px-4 py-3 border-t border-white/[0.05]">
          <span className="text-xs text-muted/60">Manually configure load parameters</span>
          <button
            onClick={() => setManualConfig(!manualConfig)}
            className={`relative w-8 h-4 rounded-full transition-colors ${manualConfig ? 'bg-accent' : 'bg-surface-3'}`}
          >
            <motion.div
              layout
              className="absolute top-0.5 w-3 h-3 rounded-full bg-white"
              style={{ left: manualConfig ? 18 : 2 }}
            />
          </button>
        </div>
      </motion.div>
    </div>
  )
}
