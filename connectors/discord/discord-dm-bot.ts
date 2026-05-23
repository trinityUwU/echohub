// Discord DM bot — streaming WebSocket vers EchoHub, style Discord markdown, strip thinking
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

const WS_URL = ECHOHUB_API_URL.replace(/^http/, "ws") + "/inference/chat_ws";
const MAX_MESSAGE_LENGTH = 1900;
const EDIT_THROTTLE_MS = 800;
const CURSOR = "▍";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = pino({
  transport: { target: "pino-pretty", options: { colorize: true } },
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatRequestBody {
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
  temperature: number;
  max_tokens: number;
}

interface WsChunk {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  done?: boolean;
  error?: string;
  type?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateEnv(): void {
  if (!DISCORD_BOT_TOKEN) { logger.error("Missing DISCORD_BOT_TOKEN"); process.exit(1); }
  if (!DISCORD_AUTHORIZED_USER_ID) { logger.error("Missing DISCORD_AUTHORIZED_USER_ID"); process.exit(1); }
}

// ---------------------------------------------------------------------------
// Text processing
// ---------------------------------------------------------------------------

function stripThinkingBlocks(text: string): string {
  // Remove complete <think>...</think> blocks
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Remove orphan opening <think> and everything after (still generating)
  out = out.replace(/<think>[\s\S]*/g, "");
  // Remove orphan closing </think>
  out = out.replace(/<\/think>/g, "");
  return out.trim();
}

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_MESSAGE_LENGTH) {
    chunks.push(remaining.slice(0, MAX_MESSAGE_LENGTH));
    remaining = remaining.slice(MAX_MESSAGE_LENGTH);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function parseWsChunk(raw: string): WsChunk | null {
  // Backend sends SSE-format strings over WS: "data: {...}"
  const line = raw.startsWith("data: ") ? raw.slice(6) : raw;
  try { return JSON.parse(line) as WsChunk; } catch { return null; }
}

function extractToken(chunk: WsChunk): string {
  return chunk.choices?.[0]?.delta?.content ?? "";
}

// ---------------------------------------------------------------------------
// Discord helpers
// ---------------------------------------------------------------------------

async function sendPlaceholder(channel: Message["channel"]): Promise<Message> {
  return (channel as { send: (c: string) => Promise<Message> }).send(CURSOR);
}

async function editSafe(msg: Message, content: string): Promise<void> {
  try { await msg.edit(content); } catch (err) { logger.warn({ err }, "edit failed"); }
}

async function sendNewMessage(channel: Message["channel"], content: string): Promise<Message> {
  return (channel as { send: (c: string) => Promise<Message> }).send(content);
}

// ---------------------------------------------------------------------------
// WebSocket inference with live edits
// ---------------------------------------------------------------------------

let isGenerating = false;

async function streamViaWebSocket(
  userContent: string,
  placeholder: Message,
  channel: Message["channel"]
): Promise<void> {
  return new Promise<void>((resolve) => {
    const ws = new WebSocket(WS_URL);
    let accumulated = "";
    let lastEdit = Date.now();
    let editTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const finish = async (finalText: string): Promise<void> => {
      if (settled) return;
      settled = true;
      if (editTimer) { clearTimeout(editTimer); editTimer = null; }

      if (!finalText) {
        await editSafe(placeholder, "*(no response)*");
        resolve(); return;
      }
      const chunks = splitIntoChunks(finalText);
      await editSafe(placeholder, chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await sendNewMessage(channel, chunks[i]);
      }
      resolve();
    };

    const scheduleEdit = (): void => {
      if (editTimer) return;
      const delay = Math.max(0, EDIT_THROTTLE_MS - (Date.now() - lastEdit));
      editTimer = setTimeout(async () => {
        editTimer = null;
        lastEdit = Date.now();
        const visible = stripThinkingBlocks(accumulated);
        if (visible) await editSafe(placeholder, visible + CURSOR);
      }, delay);
    };

    ws.onopen = (): void => {
      const body: ChatRequestBody = {
        messages: [{ role: "user", content: userContent }],
        stream: true,
        temperature: 0.7,
        max_tokens: 2048,
      };
      ws.send(JSON.stringify(body));
    };

    ws.onmessage = (event: MessageEvent): void => {
      const chunk = parseWsChunk(String(event.data));
      if (!chunk) return;

      if (chunk.error) {
        const msg = chunk.error.toLowerCase().includes("no model")
          ? "⚠️ No model loaded in EchoHub. Please load a model first."
          : `⚠️ Error: ${chunk.error}`;
        void editSafe(placeholder, msg).then(() => { settled = true; resolve(); });
        ws.close(); return;
      }

      if (chunk.done) {
        void finish(stripThinkingBlocks(accumulated));
        ws.close(); return;
      }

      const token = extractToken(chunk);
      if (token) {
        accumulated += token;
        scheduleEdit();
      }
    };

    ws.onerror = (event: Event): void => {
      logger.error({ event }, "WebSocket error");
      void finish(stripThinkingBlocks(accumulated) || "⚠️ Connection error");
    };

    ws.onclose = (): void => {
      if (!settled) void finish(stripThinkingBlocks(accumulated));
    };
  });
}

// ---------------------------------------------------------------------------
// DM handling
// ---------------------------------------------------------------------------

async function handleDmMessage(message: Message): Promise<void> {
  if (isGenerating) {
    await message.reply("⏳ Already generating, please wait...");
    return;
  }
  isGenerating = true;

  let placeholder: Message;
  try {
    placeholder = await sendPlaceholder(message.channel);
  } catch (err) {
    logger.error({ err }, "Failed to send placeholder");
    isGenerating = false;
    return;
  }

  try {
    await streamViaWebSocket(message.content, placeholder, message.channel);
  } catch (err) {
    logger.error({ err }, "Streaming failed");
    await editSafe(placeholder, `⚠️ Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    isGenerating = false;
  }
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
    logger.info({ userId: message.author.id, content: message.content.slice(0, 80) }, "DM received");
    await handleDmMessage(message);
  });

  client.on(Events.Error, (err: Error) => {
    logger.error({ err }, "Discord client error");
    if (err.message.toLowerCase().includes("token")) { logger.error("Invalid token — shutting down"); process.exit(1); }
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
