import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { NativeSkill, CommunitySkill } from '@/api/client'
import { CommunitySkillCard } from '@/components/skills/CommunitySkillCard'

// ── Detail row ─────────────────────────────────────────────────────────────────

export function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs text-text-muted uppercase tracking-wider">{label}</span>
      <span className={`text-xs text-text-secondary break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

// ── Skill section ──────────────────────────────────────────────────────────────

function SkillSection({ title, description, count, empty, children }: {
  title: string; description: string; count: number; empty?: string; children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <span className="text-xs text-text-muted">{count}</span>
      </div>
      <p className="text-xs text-text-muted -mt-1">{description}</p>
      {count === 0 && empty ? <p className="text-sm text-text-muted italic py-3">{empty}</p> : <div className="flex flex-col gap-2">{children}</div>}
    </section>
  )
}

// ── Native skill card ──────────────────────────────────────────────────────────

function NativeSkillCard({ skill }: { skill: NativeSkill }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <button onClick={() => setExpanded(v => !v)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-overlay/40 transition-colors cursor-pointer">
        <div className="w-8 h-8 rounded-md bg-accent-dim flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{skill.name}</span>
            <span className="text-2xs px-1.5 py-0.5 rounded bg-elevated text-text-muted border border-border">built-in</span>
          </div>
          <p className="text-xs text-text-muted mt-0.5 truncate">{skill.description}</p>
        </div>
        <svg className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
            <div className="px-4 pb-4 pt-1 border-t border-border flex flex-col gap-3">
              <DetailRow label="Author" value={skill.author} />
              <DetailRow label="Version" value={skill.version} />
              <DetailRow label="Storage" value={skill.storage} mono />
              <DetailRow label="Tools" value={skill.tools.join(', ')} mono />
              {skill.awareness && <DetailRow label="Awareness" value={skill.awareness} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Installed tab ──────────────────────────────────────────────────────────────

export function InstalledTab({ native, community, onDelete, onRefresh }: {
  native: NativeSkill[]; community: CommunitySkill[]; onDelete: (s: CommunitySkill) => void; onRefresh: () => void
}): React.ReactElement {
  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-8 h-full">
      <SkillSection title="Built-in skills" description="Shipped with EchoHub. Always available." count={native.length}>
        {native.map(s => <NativeSkillCard key={s.id} skill={s} />)}
      </SkillSection>
      <SkillSection title="Community skills" description="Installed from external repositories." count={community.length} empty="No community skills installed yet.">
        {community.map(s => <CommunitySkillCard key={s.id} skill={s} onDelete={() => onDelete(s)} onRefresh={onRefresh} />)}
      </SkillSection>
    </div>
  )
}
