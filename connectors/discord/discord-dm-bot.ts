// Discord DM bot — relaie les messages Discord vers l'inference EchoHub en streaming
import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  Message,
  Events,
} from "discord.js";
import pino from "pino";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? "";
const DISCORD_AUTHORIZED_USER_ID = process.env.DISCORD_AUTHORIZED_USER_ID ?? "";
const ECHOHUB_API_URL = process.env.ECHOHUB_API_URL ?? "http://localhost:37821";

const EDIT_THROTTLE_MS = 500;
const MAX_MESSAGE_LENGTH = 1900;

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = pino({
  transport: { target: "pino-pretty", options: { colorize: true } },
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  stream: boolean;
}

// EchoHub streams OpenAI-compatible SSE: {"choices": [{"delta": {"content": "..."}, "finish_reason": null|"stop"}]}
interface SSEOpenAIChunk {
  choices: Array<{ delta: { content?: string }; finish_reason: string | null }>;
}

interface SSEEchoHubStats {
  type: "echohub_stats" | "usage" | "timings";
  [key: string]: unknown;
}

interface SSEErrorEvent {
  error: string;
  error_type: string;
}

type SSEEvent = SSEOpenAIChunk | SSEEchoHubStats | SSEErrorEvent;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateEnv(): void {
  if (!DISCORD_BOT_TOKEN) {
    logger.error("Missing DISCORD_BOT_TOKEN");
    process.exit(1);
  }
  if (!DISCORD_AUTHORIZED_USER_ID) {
    logger.error("Missing DISCORD_AUTHORIZED_USER_ID");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

function parseSSELine(line: string): SSEEvent | null {
  if (!line.startsWith("data: ")) return null;
  const raw = line.slice("data: ".length).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SSEEvent;
  } catch {
    return null;
  }
}

function extractTokenFromChunk(event: SSEEvent): string | null {
  if ("choices" in event && Array.isArray(event.choices)) {
    return event.choices[0]?.delta?.content ?? null;
  }
  return null;
}

function isFinished(event: SSEEvent): boolean {
  if ("choices" in event && Array.isArray(event.choices)) {
    return event.choices[0]?.finish_reason === "stop";
  }
  return false;
}

function isErrorEvent(event: SSEEvent): event is SSEErrorEvent {
  return "error" in event;
}

// ---------------------------------------------------------------------------
// Inference streaming
// ---------------------------------------------------------------------------

let isGenerating = false;

async function fetchChatStream(userContent: string): Promise<Response> {
  const body: ChatRequestBody = {
    messages: [{ role: "user", content: userContent }],
    stream: true,
  };
  return await fetch(`${ECHOHUB_API_URL}/inference/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function consumeSSEStream(
  body: ReadableStream<Uint8Array>,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: Error) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseSSELine(line);
        if (!event) continue;
        if (isErrorEvent(event)) { onError(new Error(event.error)); return; }
        const token = extractTokenFromChunk(event);
        if (token) onToken(token);
        if (isFinished(event)) { onDone(); return; }
      }
    }
    onDone();
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    reader.releaseLock();
  }
}

async function streamInference(
  userContent: string,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: Error) => void
): Promise<void> {
  let response: Response;
  try {
    response = await fetchChatStream(userContent);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }
  if (!response.ok) {
    // 404 with "No model loaded" detail = no model loaded in EchoHub
    if (response.status === 404) {
      try {
        const body = await response.json() as { detail?: string };
        if (body?.detail?.toLowerCase().includes("no model")) {
          onError(new Error("NO_MODEL_LOADED")); return;
        }
      } catch { /* ignore parse error */ }
    }
    onError(new Error(`HTTP ${response.status}: ${response.statusText}`)); return;
  }
  if (!response.body) { onError(new Error("No response body")); return; }
  await consumeSSEStream(response.body, onToken, onDone, onError);
}

// ---------------------------------------------------------------------------
// Discord message management
// ---------------------------------------------------------------------------

async function sendInitialMessage(channel: Message["channel"]): Promise<Message> {
  return await (channel as { send: (content: string) => Promise<Message> }).send("...");
}

async function editMessage(msg: Message, content: string): Promise<void> {
  try {
    await msg.edit(content);
  } catch (err) {
    logger.warn({ err }, "Failed to edit message");
  }
}

async function sendNewMessage(channel: Message["channel"], content: string): Promise<Message> {
  return await (channel as { send: (content: string) => Promise<Message> }).send(content);
}

// ---------------------------------------------------------------------------
// DM handling
// ---------------------------------------------------------------------------

interface StreamState {
  accumulated: string;
  lastEdit: number;
  editScheduled: boolean;
  currentMsg: Message;
}

function buildTokenHandler(state: StreamState): (token: string) => void {
  return (token: string): void => {
    state.accumulated += token;
    if (Date.now() - state.lastEdit >= EDIT_THROTTLE_MS && !state.editScheduled) {
      state.editScheduled = true;
      setTimeout(async () => {
        state.editScheduled = false;
        if (state.accumulated) await editMessage(state.currentMsg, state.accumulated);
        state.lastEdit = Date.now();
      }, EDIT_THROTTLE_MS);
    }
  };
}

function buildErrorHandler(state: StreamState, onHandled: () => void): (err: Error) => Promise<void> {
  return async (err: Error): Promise<void> => {
    isGenerating = false;
    onHandled();
    if (err.message === "NO_MODEL_LOADED") {
      await editMessage(state.currentMsg, "⚠️ No model loaded in EchoHub. Please load a model first.");
    } else {
      logger.error({ err }, "Inference error");
      await editMessage(state.currentMsg, `⚠️ Error: ${err.message}`);
    }
  };
}

async function flushAccumulated(state: StreamState, channel: Message["channel"]): Promise<void> {
  if (!state.accumulated) return;
  const chunks = splitIntoChunks(state.accumulated);
  await editMessage(state.currentMsg, chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    try {
      state.currentMsg = await sendNewMessage(channel, chunks[i]);
    } catch (err) {
      logger.warn({ err }, "Failed to send continuation message");
    }
  }
}

async function handleDmMessage(message: Message): Promise<void> {
  if (isGenerating) {
    await message.reply("⏳ Already generating, please wait...");
    return;
  }
  isGenerating = true;

  let currentMsg: Message;
  try {
    currentMsg = await sendInitialMessage(message.channel);
  } catch (err) {
    logger.error({ err }, "Failed to send initial message");
    isGenerating = false;
    return;
  }

  let hadError = false;
  const state: StreamState = { accumulated: "", lastEdit: Date.now(), editScheduled: false, currentMsg };
  const onToken = buildTokenHandler(state);
  const onDone = (): void => { isGenerating = false; };
  const onError = buildErrorHandler(state, () => { hadError = true; });

  await streamInference(message.content, onToken, onDone, onError);
  if (!hadError) await flushAccumulated(state, message.channel);
  isGenerating = false;
}

// ---------------------------------------------------------------------------
// Chunk splitter
// ---------------------------------------------------------------------------

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_MESSAGE_LENGTH) {
    chunks.push(remaining.slice(0, MAX_MESSAGE_LENGTH));
    remaining = remaining.slice(MAX_MESSAGE_LENGTH);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

// ---------------------------------------------------------------------------
// Client setup
// ---------------------------------------------------------------------------

function createClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });
}

function registerClientEvents(client: Client): void {
  client.once(Events.ClientReady, (c) => {
    logger.info({ username: c.user.tag, clientId: DISCORD_CLIENT_ID }, "Discord bot ready");
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (message.channel.type !== ChannelType.DM) return;
    if (message.author.id !== DISCORD_AUTHORIZED_USER_ID) return;

    logger.info({ userId: message.author.id }, "DM received");
    await handleDmMessage(message);
  });

  client.on(Events.Error, (err: Error) => {
    logger.error({ err }, "Discord client error");
    if (err.message.toLowerCase().includes("token")) {
      logger.error("Invalid token — shutting down");
      process.exit(1);
    }
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function registerShutdownHandlers(client: Client): void {
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down");
    client.destroy();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  validateEnv();

  const client = createClient();
  registerClientEvents(client);
  registerShutdownHandlers(client);

  try {
    await client.login(DISCORD_BOT_TOKEN);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "Login failed");
    process.exit(1);
  }
}

void main();
