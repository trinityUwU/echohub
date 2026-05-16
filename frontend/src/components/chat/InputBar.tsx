import { useRef, useState, type KeyboardEvent } from 'react'
import type { ChatParams } from '@/types'

interface InputBarProps {
  modelLoaded: boolean
  streaming: boolean
  params: ChatParams
  onSend: (text: string) => void
  onStop: () => void
}

export function InputBar({ modelLoaded, streaming, params, onSend, onStop }: InputBarProps): React.ReactElement {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed || !modelLoaded || streaming) return
    onSend(trimmed)
    setText('')
  }

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  return (
    <div className="px-5 pb-4 pt-3 bg-surface border-t border-border flex-shrink-0">
      <div className="bg-elevated border border-border focus-within:border-accent rounded-lg px-3 py-2.5 flex items-end gap-2.5 transition-colors">
        <AttachBtn />
        <textarea
          ref={ref}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder={modelLoaded ? `Message ${params.temperature ? '' : ''}…` : 'Load a model to start chatting'}
          rows={1}
          className="flex-1 bg-transparent border-none outline-none resize-none font-sans text-md text-text-primary placeholder-text-muted leading-relaxed max-h-[200px] min-h-[22px]"
          style={{ height: 'auto' }}
          onInput={e => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = el.scrollHeight + 'px'
          }}
        />
        {streaming
          ? <StopBtn onClick={onStop} />
          : <SendBtn onClick={submit} disabled={!text.trim() || !modelLoaded} />
        }
      </div>
      <div className="flex justify-between items-center mt-1.5 px-0.5">
        <span className="text-xs text-text-muted">Enter to send · Shift+Enter for newline</span>
        <div className="flex gap-2">
          <ParamChip label={`temp ${params.temperature}`} />
          <ParamChip label={`top-p ${params.topP}`} />
        </div>
      </div>
    </div>
  )
}

function AttachBtn(): React.ReactElement {
  return (
    <button className="w-[30px] h-[30px] flex items-center justify-center rounded-sm hover:bg-overlay text-text-muted hover:text-text-secondary transition-colors flex-shrink-0 cursor-pointer">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
      </svg>
    </button>
  )
}

function SendBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-8 h-8 flex items-center justify-center rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex-shrink-0"
    >
      <svg className="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>
  )
}

function StopBtn({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="w-8 h-8 flex items-center justify-center rounded-sm bg-red/20 hover:bg-red/30 border border-red/30 transition-colors cursor-pointer flex-shrink-0"
    >
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" color="var(--color-red)">
        <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor"/>
      </svg>
    </button>
  )
}

function ParamChip({ label }: { label: string }): React.ReactElement {
  return (
    <span className="text-xs text-text-muted bg-overlay rounded px-1.5 py-0.5 cursor-pointer hover:text-text-secondary">
      {label}
    </span>
  )
}
