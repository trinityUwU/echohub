import { useState } from 'react'

interface ThinkingBlockProps {
  content: string
  streaming?: boolean
}

export function ThinkingBlock({ content, streaming }: ThinkingBlockProps): React.ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="bg-yellow/[0.06] border border-yellow/20 rounded-sm px-3 py-2 text-sm text-yellow cursor-pointer select-none mb-1"
      onClick={() => setOpen(v => !v)}
    >
      <div className="flex items-center gap-1.5 font-medium">
        {streaming
          ? <span className="text-xs animate-pulse">⟳</span>
          : <span className="text-xs">{open ? '▾' : '▸'}</span>
        }
        {streaming ? 'Thinking…' : `Thinking${open ? '' : ' (click to expand)'}`}
      </div>
      {open && (
        <div className="mt-2 text-xs text-yellow/70 leading-relaxed whitespace-pre-wrap">
          {content || <span className="animate-pulse">…</span>}
        </div>
      )}
    </div>
  )
}
