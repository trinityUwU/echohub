// Affichage et contrôle des connecteurs externes — Discord DM bot config et lifecycle
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getDiscordConnectorStatus,
  saveDiscordConnectorConfig,
  startDiscordConnector,
  stopDiscordConnector,
} from '@/api/client'
import type { ConnectorConfig, ConnectorStatus } from '@/api/client'

// ── Types locaux ───────────────────────────────────────────────────────────

interface FieldState {
  bot_token: string
  client_id: string
  authorized_user_id: string
}

// ── Icône Discord SVG ──────────────────────────────────────────────────────

function DiscordIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.013.045.03.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
    </svg>
  )
}

// ── Badge status animé ─────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: ConnectorStatus['status']
}

function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const config = {
    running: { label: 'Online', dotClass: 'bg-green-400', textClass: 'text-green-400', pulse: true },
    stopped: { label: 'Offline', dotClass: 'bg-zinc-500', textClass: 'text-zinc-400', pulse: false },
    error:   { label: 'Error',   dotClass: 'bg-red-400',  textClass: 'text-red-400',   pulse: false },
  }[status]

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={status}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.15 }}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-elevated border border-border"
      >
        <span className="relative flex h-2 w-2">
          {config.pulse && (
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.dotClass} opacity-60`} />
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dotClass}`} />
        </span>
        <span className={`text-xs font-medium ${config.textClass}`}>{config.label}</span>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Input avec label ───────────────────────────────────────────────────────

interface FieldInputProps {
  label: string
  value: string
  placeholder: string
  type?: 'text' | 'password'
  showToggle?: boolean
  showValue?: boolean
  onToggleShow?: () => void
  onChange: (v: string) => void
}

function FieldInput({
  label, value, placeholder, type = 'text',
  showToggle = false, showValue = false, onToggleShow, onChange,
}: FieldInputProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">{label}</label>
      <div className="relative">
        <input
          type={showToggle ? (showValue ? 'text' : 'password') : type}
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className={[
            'w-full bg-elevated rounded-sm px-3 py-2 text-sm text-text-primary',
            'placeholder:text-text-secondary/40 outline-none appearance-none',
            'border border-transparent focus:border-accent transition-colors',
            showToggle ? 'pr-10' : '',
          ].join(' ')}
        />
        {showToggle && onToggleShow && (
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text transition-colors"
            aria-label={showValue ? 'Hide token' : 'Show token'}
          >
            {showValue ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────

const SENTINEL = '***'

export function ConnectorsTab(): React.ReactElement {
  const [status, setStatus] = useState<ConnectorStatus | null>(null)
  const [fields, setFields] = useState<FieldState>({ bot_token: '', client_id: '', authorized_user_id: '' })
  const [savedFields, setSavedFields] = useState<FieldState>({ bot_token: '', client_id: '', authorized_user_id: '' })
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const s = await getDiscordConnectorStatus()
      setStatus(s)
      setLoadError(null)
      if (s.config) {
        const hydrated: FieldState = {
          // backend returns "***" if token is set, "" if lost — keep as-is
          bot_token: s.config.bot_token,
          client_id: s.config.client_id,
          authorized_user_id: s.config.authorized_user_id,
        }
        setFields(hydrated)
        // If token is empty (lost), don't mark as saved so Save button stays active
        setSavedFields(s.config.bot_token ? hydrated : { ...hydrated, bot_token: '__missing__' })
      }
    } catch (err) {
      setLoadError(String(err))
    }
  }, [])

  // Initial load
  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  // Poll when running
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (status?.status === 'running') {
      pollRef.current = setInterval(async () => {
        try {
          const s = await getDiscordConnectorStatus()
          setStatus(s)
        } catch { /* keep previous */ }
      }, 5000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [status?.status])

  const hasChanges = (
    fields.bot_token !== savedFields.bot_token ||
    fields.client_id !== savedFields.client_id ||
    fields.authorized_user_id !== savedFields.authorized_user_id
  )

  const configSaved = Boolean(
    savedFields.client_id.trim() && savedFields.authorized_user_id.trim()
  )

  const handleFieldChange = (key: keyof FieldState) => (value: string): void => {
    setFields(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const payload: ConnectorConfig = {
        bot_token: fields.bot_token === SENTINEL ? '' : fields.bot_token,
        client_id: fields.client_id,
        authorized_user_id: fields.authorized_user_id,
      }
      await saveDiscordConnectorConfig(payload)
      setSavedFields(fields)
      await refreshStatus()
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleStartStop = async (): Promise<void> => {
    setToggling(true)
    try {
      if (status?.status === 'running') {
        await stopDiscordConnector()
      } else {
        await startDiscordConnector()
      }
      await refreshStatus()
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setToggling(false)
    }
  }

  const isRunning = status?.status === 'running'

  return (
    <div className="flex flex-col gap-6">

      {/* Section header */}
      <div>
        <h2 className="text-base font-semibold text-text">Connectors</h2>
        <p className="text-sm text-text-secondary mt-0.5">
          Connect EchoHub to external messaging platforms.
        </p>
      </div>

      {/* Discord card */}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">

        {/* Card header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
              <DiscordIcon className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-text">Discord</div>
              <div className="text-xs text-text-secondary mt-0.5">
                Control EchoHub via Discord DMs. The bot responds only to your user ID.
              </div>
            </div>
          </div>
          {status && <StatusBadge status={status.status} />}
        </div>

        {/* Form */}
        <div className="px-5 py-4 flex flex-col gap-4">
          {status?.config && !status.config.bot_token && (
            <p className="text-xs text-yellow-400">Bot token missing — please re-enter it and save.</p>
          )}
          <FieldInput
            label="Bot Token"
            value={fields.bot_token}
            placeholder="Bot Token from Discord Developer Portal"
            showToggle
            showValue={showToken}
            onToggleShow={() => setShowToken(v => !v)}
            onChange={handleFieldChange('bot_token')}
          />
          <FieldInput
            label="Client ID"
            value={fields.client_id}
            placeholder="Application ID"
            onChange={handleFieldChange('client_id')}
          />
          <FieldInput
            label="Authorized User ID"
            value={fields.authorized_user_id}
            placeholder="Your Discord User ID"
            onChange={handleFieldChange('authorized_user_id')}
          />
        </div>

        {/* Error message */}
        <AnimatePresence>
          {(status?.status === 'error' || loadError) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="mx-5 mb-4 px-3 py-2.5 rounded-md bg-red-500/10 border border-red-500/25"
            >
              <p className="text-xs text-red-400 font-medium">
                {loadError ?? status?.error ?? 'An error occurred'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Actions */}
        <div className="flex items-center gap-3 px-5 pb-4">

          {/* Save */}
          <motion.button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || saving}
            whileTap={{ scale: 0.97 }}
            className={[
              'px-4 py-2 rounded-md text-sm font-medium transition-colors',
              hasChanges && !saving
                ? 'bg-accent text-white hover:bg-accent/90 cursor-pointer'
                : 'bg-elevated text-text-secondary cursor-not-allowed opacity-40',
            ].join(' ')}
          >
            {saving ? 'Saving…' : 'Save'}
          </motion.button>

          {/* Start / Stop */}
          <motion.button
            type="button"
            onClick={handleStartStop}
            disabled={!configSaved || hasChanges || toggling}
            whileTap={{ scale: 0.97 }}
            className={[
              'px-4 py-2 rounded-md text-sm font-medium transition-colors',
              configSaved && !hasChanges && !toggling
                ? isRunning
                  ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30 cursor-pointer'
                  : 'bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/30 cursor-pointer'
                : 'bg-elevated text-text-secondary cursor-not-allowed opacity-40',
            ].join(' ')}
          >
            {toggling
              ? (isRunning ? 'Stopping…' : 'Starting…')
              : (isRunning ? 'Stop' : 'Start')}
          </motion.button>

        </div>
      </div>
    </div>
  )
}
