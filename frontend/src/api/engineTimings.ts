/**
 * Shared store for llama.cpp generation timings.
 * Published by client.ts after each inference, consumed by LogsPanel.
 * Buffer persists across panel open/close.
 */

export interface GenerationTimings {
  prompt_ms: number
  eval_ms: number
  n_prompt: number
  n_eval: number
  prompt_tps: number
  eval_tps: number
  log: string
}

const MAX_BUFFER = 50

// Persists even when LogsPanel is unmounted
const buffer: string[] = []

type Listener = (lines: string[]) => void
const listeners = new Set<Listener>()

function formatTimings(t: GenerationTimings): string[] {
  const sep = '─'.repeat(60)
  const ppt = t.n_prompt > 0 ? (t.prompt_ms / t.n_prompt).toFixed(2) : '0.00'
  const ept = t.n_eval > 0 ? (t.eval_ms / t.n_eval).toFixed(2) : '0.00'
  return [
    sep,
    `prompt eval time = ${t.prompt_ms.toFixed(2).padStart(10)} ms / ${String(t.n_prompt).padStart(5)} tokens  (${ppt} ms per token, ${t.prompt_tps.toFixed(2)} tokens per second)`,
    `       eval time = ${t.eval_ms.toFixed(2).padStart(10)} ms / ${String(t.n_eval).padStart(5)} tokens  (${ept} ms per token, ${t.eval_tps.toFixed(2)} tokens per second)`,
    `      total time = ${(t.prompt_ms + t.eval_ms).toFixed(2).padStart(10)} ms / ${String(t.n_prompt + t.n_eval).padStart(5)} tokens`,
  ]
}

export function emitTimings(t: GenerationTimings): void {
  const lines = formatTimings(t)
  buffer.push(...lines)
  // Keep buffer bounded
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER)
  listeners.forEach(fn => fn([...buffer]))
}

/** Subscribe to buffer updates. Called immediately with current buffer on mount. */
export function onTimings(fn: Listener): () => void {
  fn([...buffer]) // flush current buffer on subscribe
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getTimingsBuffer(): string[] {
  return [...buffer]
}
