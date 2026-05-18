import { useRef, useState, type KeyboardEvent } from 'react'
import type { Attachment, ChatParams } from '@/types'

interface InputBarProps {
  modelLoaded: boolean
  visionEnabled: boolean
  streaming: boolean
  params: ChatParams
  usedTokens?: number
  maxTokens?: number | null
  tokensExact?: boolean
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
}

export function InputBar({ modelLoaded, visionEnabled, streaming, params, usedTokens, maxTokens, tokensExact, onSend, onStop }: InputBarProps): React.ReactElement {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const canSend = (text.trim() || attachments.length > 0) && modelLoaded && !streaming

  const submit = (): void => {
    if (!canSend) return
    onSend(text.trim(), attachments)
    setText('')
    setAttachments([])
    if (textRef.current) { textRef.current.style.height = 'auto' }
  }

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  const handleFiles = (files: FileList | null): void => {
    if (!files) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      if (file.type.startsWith('image/')) {
        reader.onload = () => {
          setAttachments(prev => [...prev, {
            id: crypto.randomUUID(), name: file.name,
            type: 'image', mimeType: file.type,
            data: reader.result as string, sizeBytes: file.size,
          }])
        }
        reader.readAsDataURL(file)
      } else {
        reader.onload = () => {
          setAttachments(prev => [...prev, {
            id: crypto.randomUUID(), name: file.name,
            type: 'text', mimeType: file.type,
            data: reader.result as string, sizeBytes: file.size,
          }])
        }
        reader.readAsText(file)
      }
    })
  }

  const handlePaste = (e: React.ClipboardEvent): void => {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find(i => i.type.startsWith('image/'))
    if (!imageItem || !visionEnabled) return
    const file = imageItem.getAsFile()
    if (file) handleFiles([file] as unknown as FileList)
  }

  return (
    <div className="px-5 pb-4 pt-3 bg-surface border-t border-border flex-shrink-0">

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachments.map(a => (
            <div key={a.id} className="relative group">
              {a.type === 'image' ? (
                <img src={a.data} alt={a.name}
                  className="w-16 h-16 object-cover rounded-sm border border-border" />
              ) : (
                <div className="w-16 h-16 bg-elevated border border-border rounded-sm flex flex-col items-center justify-center gap-1 text-text-muted">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span className="text-2xs truncate w-full text-center px-1">{a.name.split('.').pop()}</span>
                </div>
              )}
              <button onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-elevated border border-border focus-within:border-accent rounded-lg px-3 py-2.5 flex items-end gap-2.5 transition-colors">
        {visionEnabled && (
          <>
            <input ref={fileRef} type="file" className="hidden"
              accept="image/*,.txt,.md,.py,.ts,.js,.json,.csv"
              multiple onChange={e => handleFiles(e.target.files)} />
            <button onClick={() => fileRef.current?.click()}
              className="w-[30px] h-[30px] flex items-center justify-center rounded-sm hover:bg-overlay text-text-muted hover:text-text-secondary transition-colors flex-shrink-0 cursor-pointer"
              title="Attach image or file">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>
          </>
        )}
        <textarea ref={textRef} value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          placeholder={modelLoaded
            ? visionEnabled ? 'Message… (paste image with Ctrl+V)' : 'Message…'
            : 'Load a model to start chatting'}
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
          : <SendBtn onClick={submit} disabled={!canSend} />
        }
      </div>
      {/* Context usage bar */}
      {maxTokens != null && usedTokens != null && (
        <ContextBar used={usedTokens} max={maxTokens} exact={!!tokensExact} />
      )}

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

function SendBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }): React.ReactElement {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-8 h-8 flex items-center justify-center rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex-shrink-0">
      <svg className="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>
  )
}

function StopBtn({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <button onClick={onClick}
      className="w-8 h-8 flex items-center justify-center rounded-sm bg-red/20 hover:bg-red/30 border border-red/30 transition-colors cursor-pointer flex-shrink-0">
      <svg className="w-3 h-3 text-red" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
      </svg>
    </button>
  )
}

function ParamChip({ label }: { label: string }): React.ReactElement {
  return (
    <span className="text-xs text-text-muted bg-overlay rounded px-1.5 py-0.5">{label}</span>
  )
}

function ContextBar({ used, max, exact }: { used: number; max: number; exact: boolean }): React.ReactElement {
  const pct = Math.min(used / max, 1)
  const color = pct >= 0.9 ? 'bg-red' : pct >= 0.75 ? 'bg-yellow-500' : 'bg-accent'
  const usedK = used >= 1000 ? `${(used / 1000).toFixed(1)}K` : `${used}`
  const maxK = max >= 1000 ? `${(max / 1000).toFixed(0)}K` : `${max}`

  return (
    <div className="mt-2 mb-0.5 px-0.5 flex items-center gap-2">
      <div className="flex-1 h-[3px] bg-overlay rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className="text-xs text-text-muted tabular-nums flex-shrink-0">
        {!exact && <span className="opacity-50 mr-0.5">~</span>}{usedK} / {maxK} ctx
      </span>
    </div>
  )
}
