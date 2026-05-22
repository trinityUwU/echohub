import { useMemo } from 'react'
import hljs from 'highlight.js'

const _CODE_TOOLS = new Set(['create_file', 'edit_file'])

const _LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', go: 'go', sh: 'bash', bash: 'bash',
  html: 'html', css: 'css', json: 'json', md: 'markdown', yaml: 'yaml',
  yml: 'yaml', toml: 'toml', sql: 'sql', cpp: 'cpp', c: 'c',
}

function _langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return _LANG_MAP[ext] ?? 'plaintext'
}

function _unescapeContent(raw: string): string {
  return raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function _parseArgs(argsDisplay: string): Record<string, string> | null {
  try { return JSON.parse(argsDisplay.trim()) } catch { return null }
}

function _extractField(raw: string, field: string): string {
  // Works on complete AND partial JSON — regex extracts string value even if JSON is truncated
  const m = raw.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`))
  if (!m) return ''
  return m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

export function ToolCallBody({ toolName, argsDisplay, streaming }: {
  toolName: string
  argsDisplay: string
  streaming: boolean
}): React.ReactElement {
  const args = useMemo(() => _parseArgs(argsDisplay), [argsDisplay])
  const isCodeTool = _CODE_TOOLS.has(toolName)
  // Use parsed args when available (complete JSON), fall back to regex for partial JSON
  const filePath: string = args?.path ?? _extractField(argsDisplay, 'path')
  const rawCode: string = args?.content ?? _extractField(argsDisplay, 'content')
  const lang = filePath ? _langFromPath(filePath) : (rawCode ? 'auto' : 'plaintext')

  const highlighted = useMemo(() => {
    if (!isCodeTool || !rawCode) return null
    const code = _unescapeContent(rawCode)
    try {
      if (lang === 'auto') return hljs.highlightAuto(code).value
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      return hljs.highlightAuto(code).value
    }
  }, [isCodeTool, rawCode, lang])

  if (isCodeTool && (streaming || rawCode)) {
    const displayCode = streaming ? _unescapeContent(rawCode) : _unescapeContent(rawCode)
    return (
      <div className="border-t border-white/5">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.02] border-b border-white/5">
          <svg className="w-3 h-3 text-text-muted/40 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <span className="text-[11px] font-mono text-text-muted/60 flex-1 truncate">{filePath || 'file'}</span>
          <span className="text-[10px] font-mono text-text-muted/30 uppercase">{lang}</span>
          {streaming && <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-pulse" />}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {highlighted ? (
            <pre className="p-3 text-xs leading-relaxed font-mono overflow-x-auto">
              <code dangerouslySetInnerHTML={{ __html: highlighted }} />
              {streaming && <span className="inline-block w-1 h-3 bg-text-muted/40 animate-pulse rounded-sm ml-0.5 align-middle" />}
            </pre>
          ) : (
            <pre className="p-3 text-xs text-text-muted/55 leading-relaxed font-mono whitespace-pre overflow-x-auto">
              {displayCode}
              {streaming && <span className="inline-block w-1 h-3 bg-text-muted/40 animate-pulse rounded-sm ml-0.5 align-middle" />}
            </pre>
          )}
        </div>
      </div>
    )
  }

  return (
    <pre className="px-3 pb-3 pt-2 text-xs text-text-muted/60 leading-relaxed whitespace-pre-wrap border-t border-white/5 font-mono max-h-64 overflow-y-auto">
      {streaming && !argsDisplay.trim()
        ? <span className="text-text-muted/40 italic">Executing…</span>
        : argsDisplay}
      {streaming && <span className="inline-block w-1 h-3 bg-text-muted/40 animate-pulse rounded-sm ml-0.5 align-middle" />}
    </pre>
  )
}
