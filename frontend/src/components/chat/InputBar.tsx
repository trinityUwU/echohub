import { useRef, useState, useEffect, type KeyboardEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import type { Attachment, ChatParams } from '@/types'

// ── Slash commands ────────────────────────────────────────────────────────────

export type SlashCommand =
  | { id: 'clear' }
  | { id: 'compact' }
  | { id: 'tokens' }
  | { id: 'model' }
  | { id: 'files' }
  | { id: 'limit'; value: number }

interface CommandDef {
  id: string
  label: string
  description: string
  devOnly?: boolean
  hasArg?: boolean
  argPlaceholder?: string
}

const COMMANDS: CommandDef[] = [
  { id: 'clear',   label: '/clear',   description: 'Clear the conversation' },
  { id: 'compact', label: '/compact', description: 'Summarize and compact context now', devOnly: true },
  { id: 'tokens',  label: '/tokens',  description: 'Show current token count' },
  { id: 'model',   label: '/model',   description: 'Show loaded model info' },
  { id: 'files',   label: '/files',   description: 'List workspace files', devOnly: true },
  { id: 'limit',   label: '/limit',   description: 'Set tool call limit', devOnly: true, hasArg: true, argPlaceholder: 'number' },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface InputBarProps {
  modelLoaded: boolean
  visionEnabled: boolean
  streaming: boolean
  params: ChatParams
  usedTokens?: number
  maxTokens?: number | null
  tokensExact?: boolean
  isDevMode?: boolean
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
  onCommand?: (cmd: SlashCommand) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InputBar({
  modelLoaded, visionEnabled, streaming, params,
  usedTokens, maxTokens, tokensExact,
  isDevMode = false,
  onSend, onStop, onCommand,
}: InputBarProps): React.ReactElement {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const canSend = (text.trim() || attachments.length > 0) && modelLoaded && !streaming

  // Filtered commands based on current query and mode
  const filteredCmds = COMMANDS.filter(c => {
    if (c.devOnly && !isDevMode) return false
    return c.id.startsWith(slashQuery) || c.label.includes(slashQuery)
  })

  // Detect slash command mode as user types
  const handleTextChange = (val: string): void => {
    setText(val)
    if (val.startsWith('/') && !val.includes(' ')) {
      setSlashQuery(val.slice(1).toLowerCase())
      setSlashOpen(true)
      setSlashIndex(0)
    } else {
      setSlashOpen(false)
    }
  }

  // Close slash menu on click outside
  useEffect(() => {
    if (!slashOpen) return
    const handler = (): void => setSlashOpen(false)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [slashOpen])

  const executeCommand = (def: CommandDef, argStr?: string): void => {
    setSlashOpen(false)
    setText('')
    if (textRef.current) textRef.current.style.height = 'auto'
    if (!onCommand) return

    if (def.id === 'limit') {
      const n = parseInt(argStr ?? '', 10)
      if (!isNaN(n) && n > 0) onCommand({ id: 'limit', value: n })
      return
    }
    onCommand({ id: def.id } as SlashCommand)
  }

  const selectCommand = (def: CommandDef): void => {
    if (def.hasArg) {
      // Fill in the command name, let user type the arg
      setText(`/${def.id} `)
      setSlashOpen(false)
      textRef.current?.focus()
      return
    }
    executeCommand(def)
  }

  const submit = (): void => {
    // Check if it's a complete slash command with optional arg
    const trimmed = text.trim()
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(' ')
      const cmdId = parts[0].toLowerCase()
      const argStr = parts.slice(1).join(' ')
      const def = COMMANDS.find(c => c.id === cmdId)
      if (def) {
        executeCommand(def, argStr)
        return
      }
    }
    if (!canSend) return
    onSend(trimmed, attachments)
    setText('')
    setAttachments([])
    if (textRef.current) textRef.current.style.height = 'auto'
  }

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (slashOpen && filteredCmds.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex(i => (i + 1) % filteredCmds.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex(i => (i - 1 + filteredCmds.length) % filteredCmds.length)
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        selectCommand(filteredCmds[slashIndex])
        return
      }
      if (e.key === 'Escape') {
        setSlashOpen(false)
        return
      }
    }
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
    if (imageItem) {
      const file = imageItem.getAsFile()
      if (file) handleFiles([file] as unknown as FileList)
      return
    }
    if (!visionEnabled) return
    e.preventDefault()
    invoke<string | null>('read_clipboard_image').then(dataUrl => {
      if (!dataUrl) {
        const t = e.clipboardData.getData('text')
        if (t) document.execCommand('insertText', false, t)
        return
      }
      const byteStr = atob(dataUrl.split(',')[1])
      const arr = new Uint8Array(byteStr.length)
      for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i)
      const blob = new Blob([arr], { type: 'image/png' })
      const file = new File([blob], 'clipboard.png', { type: 'image/png' })
      handleFiles([file] as unknown as FileList)
    }).catch(() => {})
  }

  return (
    <div className="px-5 pb-4 pt-3 bg-surface border-t border-border flex-shrink-0">

      {/* Attachments */}
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

      {/* Slash command menu */}
      <AnimatePresence>
        {slashOpen && filteredCmds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.12 }}
            className="mb-2 rounded-lg border border-border bg-elevated shadow-xl overflow-hidden"
            onMouseDown={e => e.preventDefault()}
          >
            {filteredCmds.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => selectCommand(cmd)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer ${
                  i === slashIndex ? 'bg-accent/15' : 'hover:bg-overlay'
                }`}
              >
                <span className="text-xs font-mono font-semibold text-accent w-24 flex-shrink-0">{cmd.label}{cmd.hasArg ? ` <${cmd.argPlaceholder}>` : ''}</span>
                <span className="text-xs text-text-muted">{cmd.description}</span>
                {cmd.devOnly && (
                  <span className="ml-auto text-2xs text-yellow-400/60 flex-shrink-0">dev</span>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area */}
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
          onChange={e => handleTextChange(e.target.value)}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          placeholder={modelLoaded
            ? 'Message… · type / for commands'
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

      {/* Context bar */}
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

// ── Sub-components ────────────────────────────────────────────────────────────

function SendBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }): React.ReactElement {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-8 h-8 flex items-center justify-center rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex-shrink-0">
      <svg className="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
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
