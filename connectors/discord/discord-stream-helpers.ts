// Streaming SSE depuis EchoHub — parse SSE, streamChatSSE, finishStream, onStreamError
import http from "http";
import https from "https";
import pino from "pino";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, Message } from "discord.js";
import type { ConversationMessage } from "./discord-api-helpers.ts";

const ECHOHUB_API_URL = process.env.ECHOHUB_API_URL ?? "http://localhost:37821";

export const MAX_EMBED_LENGTH = 3900;
const EDIT_THROTTLE_MS = 800;
export const CURSOR = "▍";

const logger = pino({
  transport: { target: "pino-pretty", options: { colorize: true } },
});

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

export function stripGenerationArtifacts(text: string): string {
  let out = text;
  // Strip thinking blocks
  out = out.replace(/<think>[\s\S]*?<\/think>/g, "\n\n---\n\n");
  out = out.replace(/<think>[\s\S]*/g, "");
  out = out.replace(/<\/think>/g, "\n\n---\n\n");
  // Strip tool calls with indicator
  out = out.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "\n🔧 *Tool call*\n");
  out = out.replace(/<tool_response>[\s\S]*?<\/tool_response>/g, "\n📥 *Tool result*\n");
  // Strip orphaned tags
  out = out.replace(/<tool_call>[\s\S]*/g, "");
  out = out.replace(/<\/tool_call>/g, "");
  out = out.replace(/<tool_response>[\s\S]*/g, "");
  out = out.replace(/<\/tool_response>/g, "");
  // Deduplicate consecutive separators
  out = out.replace(/(\n\n---\n\n){2,}/g, "\n\n---\n\n");
  return out.trim();
}

export interface SSEToolEvent { type: "tool_call" | "tool_result"; name?: string; tool?: string; data: string }

type SSEJson = {
  type?: string;
  content?: string;
  choices?: Array<{ delta?: { content?: string } }>;
  name?: string;
  tool?: string;
  args?: unknown;
  arguments?: string;
  result?: unknown;
  output?: string;
};

export function parseSSEChunk(
  raw: string,
  onToolEvent?: (event: SSEToolEvent) => void,
): string {
  let token = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const json = JSON.parse(line.slice(6)) as SSEJson;
      if (!json || typeof json !== "object") continue;

      // Format generate_with_tools: {"type": "text_chunk", "content": "..."}
      if (json.type === "text_chunk" && typeof json.content === "string") {
        token += json.content; continue;
      }
      if (json.type === "tool_call") {
        onToolEvent?.({
          type: "tool_call",
          name: json.name ?? (json.tool as string | undefined),
          data: json.arguments ?? JSON.stringify(json.args ?? ""),
        });
        continue;
      }
      if (json.type === "tool_result") {
        onToolEvent?.({
          type: "tool_result",
          tool: json.tool,
          data: json.output ?? String(json.result ?? ""),
        });
        continue;
      }
      // Skip any remaining typed events (discord_done, etc.)
      if (json.type) continue;

      // Format OpenAI standard (generate normal): {"choices": [...]}
      token += json.choices?.[0]?.delta?.content ?? "";
    } catch { /* partial chunk */ }
  }
  return token;
}

export function isDone(raw: string): boolean {
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const json = JSON.parse(line.slice(6)) as { done?: boolean; type?: string };
      if (json.done === true || json.type === "discord_done") return true;
    } catch { /* partial */ }
  }
  return false;
}

// ---------------------------------------------------------------------------
// HTTP SSE streaming
// ---------------------------------------------------------------------------

export interface ChatSSEBody {
  conv_id: string;
  messages: ConversationMessage[];
  user_message_id: string;
  temperature: number;
  max_tokens: number;
  system_prompt?: string;
}

function handle404Response(
  res: http.IncomingMessage,
  onError: (err: Error) => void,
): void {
  let raw = "";
  res.on("data", (c: Buffer) => { raw += c.toString(); });
  res.on("end", () => {
    try {
      const detail = (JSON.parse(raw) as { detail?: string }).detail ?? "";
      if (detail.toLowerCase().includes("no model")) {
        onError(new Error("NO_MODEL_LOADED")); return;
      }
    } catch { /* ignore */ }
    onError(new Error("HTTP 404: Not Found"));
  });
}

function extractDiscordError(raw: string): string | null {
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const json = JSON.parse(line.slice(6)) as Record<string, unknown>;
      if (json.type === "discord_error" && typeof json.error === "string") return json.error;
    } catch { /* ignore malformed SSE lines */ }
  }
  return null;
}

function handleSSEResponse(
  res: http.IncomingMessage,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  onToolEvent?: (event: SSEToolEvent) => void,
): void {
  if (res.statusCode === 404) { handle404Response(res, onError); return; }
  if (!res.statusCode || res.statusCode >= 400) { onError(new Error(`HTTP ${res.statusCode}`)); return; }
  let settled = false;
  const done = (): void => { if (settled) return; settled = true; onDone(); };
  const error = (err: Error): void => { if (settled) return; settled = true; onError(err); };
  res.on("data", (chunk: Buffer) => {
    const raw = chunk.toString();
    if (isDone(raw)) { done(); return; }
    const errMsg = extractDiscordError(raw);
    if (errMsg) { error(new Error(errMsg)); return; }
    const token = parseSSEChunk(raw, onToolEvent);
    if (token) onToken(token);
  });
  res.on("end", done);
  res.on("error", (err: Error) => {
    if (settled) { logger.warn({ err }, "socket error after stream settled"); return; }
    error(err);
  });
}

export function streamChatSSE(
  body: ChatSSEBody,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  onToolEvent?: (event: SSEToolEvent) => void,
): void {
  const url = new URL(`${ECHOHUB_API_URL}/connectors/discord/chat`);
  const bodyStr = JSON.stringify(body);
  const transport = url.protocol === "https:" ? https : http;
  const req = transport.request(
    {
      hostname: url.hostname,
      port: parseInt(url.port) || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
        Accept: "text/event-stream",
      },
    },
    (res) => handleSSEResponse(res, onToken, onDone, onError, onToolEvent),
  );
  req.on("error", onError);
  req.write(bodyStr);
  req.end();
}

// ---------------------------------------------------------------------------
// Stream state management
// ---------------------------------------------------------------------------

export interface StreamState {
  accumulated: string;
  lastEdit: number;
  editTimer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

export interface StreamCallbacks {
  buildEmbed: (desc: string, done: boolean) => EmbedBuilder;
  buildResponseActionRow: () => ActionRowBuilder<ButtonBuilder>;
  editEmbed: (msg: Message, desc: string, done: boolean) => Promise<void>;
  onAssistantContent: (content: string) => void;
  setGenerating: (v: boolean) => void;
  onToolEvent?: (event: SSEToolEvent) => void;
}

type SendableChannel = { send: (opts: object) => Promise<Message> };

export function scheduleEmbedEdit(
  state: StreamState,
  placeholder: Message,
  editEmbed: (msg: Message, desc: string, done: boolean) => Promise<void>,
): void {
  if (state.editTimer || state.settled) return;
  const delay = Math.max(0, EDIT_THROTTLE_MS - (Date.now() - state.lastEdit));
  state.editTimer = setTimeout(async () => {
    state.editTimer = null;
    state.lastEdit = Date.now();
    const visible = stripGenerationArtifacts(state.accumulated);
    await editEmbed(placeholder, (visible || CURSOR) + CURSOR, false);
  }, delay);
}

export async function onStreamError(
  state: StreamState,
  err: Error,
  placeholder: Message,
  cbs: Pick<StreamCallbacks, "setGenerating" | "editEmbed">,
): Promise<void> {
  if (state.settled) return;
  state.settled = true;
  if (state.editTimer) { clearTimeout(state.editTimer); state.editTimer = null; }
  cbs.setGenerating(false);
  logger.error({ message: err.message, stack: err.stack }, "Stream inference error");
  const msg = err.message === "NO_MODEL_LOADED"
    ? "⚠️ No model loaded in EchoHub. Please load a model first."
    : `⚠️ ${err.message}`;
  await cbs.editEmbed(placeholder, msg, false);
}

export async function finishStream(
  state: StreamState,
  placeholder: Message,
  channel: Message["channel"],
  cbs: StreamCallbacks,
): Promise<void> {
  if (state.settled) return;
  state.settled = true;
  if (state.editTimer) { clearTimeout(state.editTimer); state.editTimer = null; }
  cbs.setGenerating(false);
  logger.info({ accumulatedLength: state.accumulated.length }, "finishStream: accumulated length");
  const final = stripGenerationArtifacts(state.accumulated);
  if (!final) {
    logger.warn("finishStream: empty accumulated — model may have returned nothing");
    await cbs.editEmbed(placeholder, "⚠️ No response from model. Check that a model is loaded in EchoHub.", true);
    return;
  }
  cbs.onAssistantContent(final);
  const row = cbs.buildResponseActionRow();
  if (final.length <= MAX_EMBED_LENGTH) {
    try { await placeholder.edit({ embeds: [cbs.buildEmbed(final, true)], components: [row] }); }
    catch (err) { logger.warn({ err }, "embed edit with buttons failed"); }
    return;
  }
  await cbs.editEmbed(placeholder, final.slice(0, MAX_EMBED_LENGTH), true);
  let remaining = final.slice(MAX_EMBED_LENGTH);
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, MAX_EMBED_LENGTH);
    remaining = remaining.slice(MAX_EMBED_LENGTH);
    try {
      const isLast = remaining.length === 0;
      await (channel as unknown as SendableChannel).send({
        embeds: [cbs.buildEmbed(chunk, true)],
        components: isLast ? [row] : [],
      });
    } catch (err) { logger.warn({ err }, "embed send chunk failed"); }
  }
}
