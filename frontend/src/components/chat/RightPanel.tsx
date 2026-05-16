import { useState } from 'react'
import { Accordion } from '@/components/shared/Accordion'
import { Slider } from '@/components/shared/Slider'
import { Toggle } from '@/components/shared/Toggle'
import type { ChatParams } from '@/types'

interface RightPanelProps {
  params: ChatParams
  onChange: (p: ChatParams) => void
}

const PROFILES = ['Default', 'Coder', 'Creative']

export function RightPanel({ params, onChange }: RightPanelProps): React.ReactElement {
  const set = <K extends keyof ChatParams>(k: K, v: ChatParams[K]): void => onChange({ ...params, [k]: v })

  return (
    <aside className="w-[260px] bg-surface border-l border-border flex flex-col flex-shrink-0 overflow-y-auto">
      <Accordion title="Profile">
        <ProfileSelector />
      </Accordion>
      <Accordion title="System Prompt">
        <textarea
          value={params.systemPrompt}
          onChange={e => set('systemPrompt', e.target.value)}
          placeholder="You are a helpful assistant…"
          className="w-full bg-elevated border border-border focus:border-border-hover rounded-sm px-2.5 py-2 text-sm text-text-primary placeholder-text-muted resize-y outline-none leading-relaxed min-h-[80px] transition-colors"
        />
      </Accordion>
      <Accordion title="Parameters">
        <Slider label="Temperature"  value={params.temperature}     min={0}   max={2}     step={0.01} onChange={v => set('temperature', v)} />
        <Slider label="Max Tokens"   value={params.maxTokens}       min={256} max={16384} step={256}  onChange={v => set('maxTokens', v)} formatValue={v => v.toLocaleString('en')} />
        <Slider label="Top P"        value={params.topP}            min={0}   max={1}     step={0.01} onChange={v => set('topP', v)} />
        <Slider label="Top K"        value={params.topK < 0 ? 40 : params.topK} min={1} max={100} step={1} onChange={v => set('topK', v)} />
        <Slider label="Rep. Penalty" value={params.repetitionPenalty} min={1} max={2}     step={0.01} onChange={v => set('repetitionPenalty', v)} />
      </Accordion>
      <Accordion title="Features">
        <ToggleRow label="Enable thinking"    value={params.enableThinking} onChange={v => set('enableThinking', v)} />
        <ToggleRow label="Stream output"      value={true}  onChange={() => {}} />
        <ToggleRow label="Auto-title"         value={true}  onChange={() => {}} />
        <ToggleRow label="Context compaction" value={false} onChange={() => {}} />
      </Accordion>
    </aside>
  )
}

function ProfileSelector(): React.ReactElement {
  const [active, setActive] = useState('Default')
  return (
    <div className="flex gap-1.5 flex-wrap">
      {PROFILES.map(p => (
        <button key={p} onClick={() => setActive(p)}
          className={`text-xs px-2.5 py-1 rounded-[20px] border cursor-pointer transition-colors ${
            active === p ? 'bg-accent-dim border-accent/35 text-accent' : 'bg-elevated border-border text-text-secondary hover:border-border-hover'
          }`}>{p}</button>
      ))}
      <button className="text-xs px-2.5 py-1 rounded-[20px] border border-border text-text-muted hover:border-border-hover cursor-pointer">+ New</button>
    </div>
  )
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }): React.ReactElement {
  return (
    <div className="flex justify-between items-center py-1.5 text-sm text-text-secondary">
      <span>{label}</span>
      <Toggle on={value} onChange={onChange} />
    </div>
  )
}
