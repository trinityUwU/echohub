/**
 * Shared store for llama.cpp generation timings.
 * Published by client.ts after each inference, consumed by LogsPanel.
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

type Listener = (t: GenerationTimings) => void
const listeners = new Set<Listener>()

export function onTimings(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emitTimings(t: GenerationTimings): void {
  listeners.forEach(fn => fn(t))
}
