import { http, HttpResponse, delay } from 'msw'
import {
  MOCK_CONVERSATIONS, MOCK_MESSAGES, MOCK_DOWNLOADED_MODELS,
  MOCK_LOADED_MODEL, MOCK_SEARCH_RESULTS, MOCK_GPU, MOCK_GPU_BACKEND,
  MOCK_DOWNLOAD_JOBS,
} from './data'

const BASE = '/api'

// ── Conversations ──────────────────────────────────────────────────────────

export const handlers = [

  http.get(`${BASE}/conversations`, async () => {
    await delay(80)
    return HttpResponse.json(MOCK_CONVERSATIONS)
  }),

  http.post(`${BASE}/conversations`, async ({ request }) => {
    const body = await request.json() as { id: string; title: string; model_id?: string }
    const conv = {
      id: body.id,
      title: body.title ?? 'New Chat',
      model_id: body.model_id ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      message_count: 0,
    }
    return HttpResponse.json(conv, { status: 201 })
  }),

  http.put(`${BASE}/conversations/:id`, async ({ params, request }) => {
    const body = await request.json() as { title?: string; model_id?: string }
    const conv = MOCK_CONVERSATIONS.find(c => c.id === params.id) ?? MOCK_CONVERSATIONS[0]
    return HttpResponse.json({ ...conv, ...body, updated_at: new Date().toISOString() })
  }),

  http.delete(`${BASE}/conversations/:id`, async () => {
    await delay(50)
    return HttpResponse.json({ status: 'deleted' })
  }),

  http.get(`${BASE}/conversations/:id/messages`, async ({ params }) => {
    await delay(100)
    const msgs = MOCK_MESSAGES[params.id as string] ?? []
    return HttpResponse.json(msgs)
  }),

  http.post(`${BASE}/conversations/:id/messages`, async ({ request }) => {
    const body = await request.json() as object
    return HttpResponse.json({ ...(body as object), created_at: new Date().toISOString() }, { status: 201 })
  }),

  http.delete(`${BASE}/conversations/:id/messages`, async () => {
    return HttpResponse.json({ status: 'cleared' })
  }),

  // ── Models ──────────────────────────────────────────────────────────────

  http.get(`${BASE}/models/downloaded`, async () => {
    await delay(120)
    return HttpResponse.json(MOCK_DOWNLOADED_MODELS)
  }),

  http.get(`${BASE}/models/search`, async ({ request }) => {
    const url = new URL(request.url)
    const q = url.searchParams.get('q') ?? ''
    await delay(300)
    const results = MOCK_SEARCH_RESULTS.filter(m =>
      m.id.toLowerCase().includes(q.toLowerCase()) ||
      m.name.toLowerCase().includes(q.toLowerCase())
    )
    return HttpResponse.json(results.length ? results : MOCK_SEARCH_RESULTS)
  }),

  http.get(`${BASE}/models/info/:modelId`, async ({ params }) => {
    await delay(200)
    const id = decodeURIComponent(params.modelId as string)
    const model = [...MOCK_DOWNLOADED_MODELS, ...MOCK_SEARCH_RESULTS].find(m => m.id === id)
    if (!model) return new HttpResponse(null, { status: 404 })
    return HttpResponse.json(model)
  }),

  http.post(`${BASE}/models/download`, async ({ request }) => {
    const body = await request.json() as { model_id: string }
    await delay(100)
    return HttpResponse.json({ status: 'started', model_id: body.model_id })
  }),

  http.delete(`${BASE}/models/download/:modelId`, async () => {
    return HttpResponse.json({ status: 'cancelled' })
  }),

  http.delete(`${BASE}/models/downloaded/:modelId`, async () => {
    return HttpResponse.json({ status: 'deleted' })
  }),

  http.get(`${BASE}/models/downloads`, async () => {
    return HttpResponse.json(MOCK_DOWNLOAD_JOBS)
  }),

  http.post(`${BASE}/models/check-access`, async ({ request }) => {
    const body = await request.json() as { model_id: string }
    await delay(150)
    const model = [...MOCK_DOWNLOADED_MODELS, ...MOCK_SEARCH_RESULTS].find(m => m.id === body.model_id)
    if (model?.gated) {
      return HttpResponse.json({
        accessible: false, gated: true,
        reason: 'token_required',
        hf_url: `https://huggingface.co/${body.model_id}`,
      })
    }
    return HttpResponse.json({ accessible: true, gated: false })
  }),

  // ── Inference ───────────────────────────────────────────────────────────

  http.post(`${BASE}/inference/load`, async ({ request }) => {
    const body = await request.json() as { model_id: string }
    await delay(200)
    return HttpResponse.json({ status: 'loading', model_id: body.model_id })
  }),

  http.get(`${BASE}/inference/load-state`, async () => {
    return HttpResponse.json({ loading_model_id: null, loaded_model_id: MOCK_LOADED_MODEL.id, error: null })
  }),

  http.post(`${BASE}/inference/unload`, async () => {
    await delay(300)
    return HttpResponse.json({ status: 'unloaded' })
  }),

  http.get(`${BASE}/inference/status`, async () => {
    return HttpResponse.json(MOCK_LOADED_MODEL)
  }),

  http.get(`${BASE}/inference/engine`, async () => {
    return HttpResponse.json({ engine: 'llama', available_engines: ['llama', 'vllm'] })
  }),

  http.post(`${BASE}/inference/chat`, async ({ request }) => {
    const body = await request.json() as { messages: { content: string }[] }

    // Simuler un stream SSE de réponse
    const lastMsg = body.messages?.[body.messages.length - 1]
    const userText = typeof lastMsg?.content === 'string' ? lastMsg.content : 'hello'

    const responses: Record<string, string> = {
      default: 'I understand your question. Let me think about this carefully.\n\nThis is a mock response from MSW. The real model would provide a much more detailed and accurate answer here.\n\nThe response demonstrates streaming — each word appears token by token, just like a real LLM would respond.',
      ping: 'Pong! The mock service worker is running correctly.',
      hello: "Hello! I'm EchoHub's mock assistant. The real model is not connected yet — this is MSW simulating responses for design development.",
    }

    const key = Object.keys(responses).find(k => userText.toLowerCase().includes(k)) ?? 'default'
    const responseText = responses[key]
    const words = responseText.split(' ')

    const stream = new ReadableStream({
      async start(controller) {
        // Thinking block simulé
        const thinkChunks = ['<think>\nLet me consider this question carefully...\nThe user is asking about: ' + userText.slice(0, 50) + '\nI should provide a helpful response.\n</think>\n\n']
        for (const chunk of thinkChunks) {
          const payload = JSON.stringify({ choices: [{ delta: { content: chunk }, finish_reason: null }] })
          controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`))
          await new Promise(r => setTimeout(r, 50))
        }

        // Réponse principale mot par mot
        for (const word of words) {
          const payload = JSON.stringify({ choices: [{ delta: { content: word + ' ' }, finish_reason: null }] })
          controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`))
          await new Promise(r => setTimeout(r, 30 + Math.random() * 20))
        }

        // Stats finales
        const usage = JSON.stringify({ usage: { completion_tokens: words.length, prompt_tokens: 20 } })
        controller.enqueue(new TextEncoder().encode(`data: ${usage}\n\n`))
        controller.close()
      },
    })

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  }),

  http.post(`${BASE}/inference/summarize`, async () => {
    await delay(500)
    return HttpResponse.json({ summary: 'The conversation discussed quantum entanglement and its applications in quantum computing, covering superposition, error correction, and key algorithms.' })
  }),

  // ── System ──────────────────────────────────────────────────────────────

  http.get(`${BASE}/system/gpu`, async () => {
    // Légère variation pour simuler le polling
    const variation = Math.floor(Math.random() * 200 - 100)
    return HttpResponse.json({
      ...MOCK_GPU,
      vram_used_mb: MOCK_GPU.vram_used_mb + variation,
      gpu_utilization_pct: Math.max(5, MOCK_GPU.gpu_utilization_pct + Math.floor(Math.random() * 10 - 5)),
    })
  }),

  http.get(`${BASE}/system/engine-log`, async () => {
    return HttpResponse.text('[llama] Model loaded in 1.5s\n[llama] n_gpu_layers=-1 | CUDA active\n[llama] Ready')
  }),

  http.get(`${BASE}/system/vllm-log`, async () => {
    return HttpResponse.text('[mock] vLLM not active in MSW mode')
  }),

  // ── Settings ────────────────────────────────────────────────────────────

  http.get(`${BASE}/settings/gpu-backend`, async () => {
    return HttpResponse.json(MOCK_GPU_BACKEND)
  }),

  http.get(`${BASE}/settings/hf-token`, async () => {
    return HttpResponse.json({ token_set: false, token_preview: '' })
  }),

  http.post(`${BASE}/settings/hf-token`, async () => {
    return HttpResponse.json({ status: 'ok', token_set: true })
  }),

  http.get(`${BASE}/health`, async () => {
    return HttpResponse.json({ status: 'ok' })
  }),
]
