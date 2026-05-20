import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { patchSkill, configureMcp, analyzeSkillStream } from '@/api/client'
import type { CommunitySkill, AnalyzeResult } from '@/api/client'
import { DetailRow } from '@/components/skills/InstalledTab'
import { McpSection } from '@/components/skills/McpSection'

export function CommunitySkillCard({ skill, onDelete, onRefresh }: { skill: CommunitySkill; onDelete: () => void; onRefresh: () => void }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [tools, setTools] = useState(skill.tools.join(', '))
  const [awareness, setAwareness] = useState(skill.awareness)
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeLog, setAnalyzeLog] = useState<string[]>([])
  const [analyzeTokens, setAnalyzeTokens] = useState('')
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const analyzeLogRef = useRef<HTMLDivElement>(null)
  const hasTools = skill.tools.length > 0

  useEffect(() => {
    if (analyzeLogRef.current) {
      analyzeLogRef.current.scrollTop = analyzeLogRef.current.scrollHeight
    }
  }, [analyzeLog, analyzeTokens])

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const toolList = tools.split(',').map(t => t.trim()).filter(Boolean)
      await patchSkill(skill.id, { tools: toolList, awareness })
      onRefresh()
      setEditing(false)
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleAnalyze = async (): Promise<void> => {
    setAnalyzing(true)
    setAnalyzeError(null)
    setAnalyzeLog([])
    setAnalyzeTokens('')
    try {
      let result: AnalyzeResult | null = null
      for await (const event of analyzeSkillStream(skill.id)) {
        if (event.type === 'log') {
          setAnalyzeLog(prev => [...prev, event.msg])
        } else if (event.type === 'token') {
          setAnalyzeTokens(prev => prev + event.content)
        } else if (event.type === 'done') {
          result = event.result
        } else if (event.type === 'error') {
          const msg = event.message
          setAnalyzeError(msg.includes('No model') ? 'No model loaded — load a model from the Chat page first.' : msg)
          setAnalyzing(false)
          return
        }
      }
      if (result) {
        setTools(result.suggested_tools.join(', '))
        setAwareness(result.suggested_awareness)
        setEditing(true)
        // Auto-persist MCP config if detected
        if (result.is_mcp && result.mcp_start_command) {
          configureMcp(skill.id, {
            start_command: result.mcp_start_command,
            port: result.mcp_transport === 'http' ? 3000 : undefined,
          }).catch(() => {})
          patchSkill(skill.id, {
            tools: result.suggested_tools,
            awareness: result.suggested_awareness,
          }).then(() => onRefresh()).catch(() => {})
        }
      }
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : 'Analysis failed')
    }
    setAnalyzing(false)
  }

  return (
    <div className={`bg-surface border rounded-lg overflow-hidden transition-colors ${!hasTools ? 'border-yellow/30' : 'border-border'}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button onClick={() => setExpanded(v => !v)} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer">
          <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border ${!hasTools ? 'bg-yellow/10 border-yellow/30' : 'bg-elevated border-border'}`}>
            {!hasTools
              ? <svg className="w-4 h-4 text-yellow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              : <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{skill.name}</span>
              <span className="text-2xs text-text-muted">v{skill.version}</span>
              {!hasTools && <span className="text-2xs text-yellow px-1.5 py-0.5 rounded bg-yellow/10 border border-yellow/30">Setup required</span>}
            </div>
            <p className="text-xs text-text-muted mt-0.5 truncate">{skill.description}</p>
          </div>
          <svg className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 mr-1 ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <button onClick={onDelete} className="w-7 h-7 flex items-center justify-center rounded hover:bg-red/15 text-text-muted hover:text-red transition-colors flex-shrink-0 cursor-pointer" title="Remove">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
            <div className="px-4 pb-4 pt-1 border-t border-border flex flex-col gap-3">
              <DetailRow label="Author" value={skill.author} />
              <DetailRow label="Repository" value={skill.repo_url} mono />
              <DetailRow label="Path" value={skill.path} mono />

              {skill.is_mcp !== false && <McpSection skill={skill} />}

              {!editing ? (
                <>
                  {hasTools
                    ? <DetailRow label="Tools" value={skill.tools.join(', ')} mono />
                    : (
                      <div className="flex flex-col gap-1">
                        <span className="text-2xs text-text-muted uppercase tracking-wider">Tools</span>
                        <p className="text-xs text-yellow">No tools declared — configure below so the model can use this skill.</p>
                      </div>
                    )
                  }
                  {skill.awareness && <DetailRow label="Awareness" value={skill.awareness} />}
                  {(analyzing || analyzeLog.length > 0 || analyzeTokens) && (
                    <div className="flex flex-col gap-1">
                      <div
                        ref={analyzeLogRef}
                        className="bg-base border border-border rounded-sm px-3 py-2 max-h-[140px] overflow-y-auto font-mono text-xs text-text-secondary space-y-0.5"
                      >
                        {analyzeLog.map((msg, i) => (
                          <div key={i} className="text-text-muted leading-relaxed">▸ {msg}</div>
                        ))}
                        {analyzeTokens && (
                          <div className="text-text-primary leading-relaxed whitespace-pre-wrap">{analyzeTokens}{analyzing && <span className="animate-pulse">▌</span>}</div>
                        )}
                        {analyzing && !analyzeTokens && (
                          <div className="text-text-muted animate-pulse">Waiting for model...</div>
                        )}
                      </div>
                    </div>
                  )}
                  {analyzeError && (
                    <div className="flex items-start gap-2 px-3 py-2.5 bg-elevated border border-border rounded-md">
                      <svg className="w-3.5 h-3.5 text-text-muted flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      <p className="text-xs text-text-secondary leading-relaxed">{analyzeError}</p>
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={handleAnalyze}
                      disabled={analyzing}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-white transition-colors cursor-pointer"
                    >
                      {analyzing ? (
                        <><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Analyzing…</>
                      ) : (
                        <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 8v4l3 3"/></svg>Auto-configure with AI</>
                      )}
                    </button>
                    <button
                      onClick={() => setEditing(true)}
                      className="text-xs px-3 py-1.5 rounded-sm border border-border text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                    >
                      {hasTools ? 'Edit manually' : 'Configure manually'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-2xs text-text-muted uppercase tracking-wider">Tools (comma-separated tool names)</label>
                    <input
                      type="text"
                      value={tools}
                      onChange={e => setTools(e.target.value)}
                      placeholder="tool_name_1, tool_name_2"
                      className="bg-base border border-border focus:border-accent/60 rounded-sm px-2.5 py-1.5 text-xs font-mono text-text-primary placeholder-text-muted outline-none transition-colors"
                    />
                    <p className="text-2xs text-text-muted">Tool names exposed by this skill to the model. Must match what the skill actually registers.</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-2xs text-text-muted uppercase tracking-wider">Awareness block (≤100 tokens)</label>
                    <textarea
                      value={awareness}
                      onChange={e => setAwareness(e.target.value)}
                      rows={3}
                      placeholder="Describe how the model should use this skill's tools..."
                      className="bg-base border border-border focus:border-accent/60 rounded-sm px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none resize-none transition-colors"
                    />
                    <p className="text-2xs text-text-muted">Injected into the system prompt when this skill is active. Keep concise.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="text-xs px-3 py-1.5 rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-white transition-colors cursor-pointer"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditing(false); setTools(skill.tools.join(', ')); setAwareness(skill.awareness) }}
                      className="text-xs px-3 py-1.5 rounded-sm border border-border text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
