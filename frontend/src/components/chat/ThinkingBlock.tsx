import { useState } from 'react'

interface ThinkingBlockProps { content: string }

export function ThinkingBlock({ content }: ThinkingBlockProps): React.ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-yellow/[0.06] border border-yellow/20 rounded-sm px-3 py-2 text-sm text-yellow cursor-pointer select-none mb-1"
      onClick={() => setOpen(v => !v)}>
      <div className="flex items-center gap-1.5 font-medium">
        <span className="text-xs">{open ? '▾' : '▸'}</span>
        Thinking
      </div>
      {open && (
        <div className="mt-2 text-xs text-yellow/70 leading-relaxed">{content}</div>
      )}
    </div>
  )
}
