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

// EchoHub non-stream response: OpenAI-compatible choices object
interface ChatResponse {
  choices: Array<{ message: { content: string }; finish_reason: string }>;
}

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
// Inference (non-stream — Bun ReadableStream SSE has socket issues)
// ---------------------------------------------------------------------------

let isGenerating = false;

async function fetchChatResponse(userContent: string): Promise<string> {
  const body: ChatRequestBody = {
    messages: [{ role: "user", content: userContent }],
    stream: false,
  };
  const response = await fetch(`${ECHOHUB_API_URL}/inference/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 404) {
      try {
        const err = await response.json() as { detail?: string };
        if (err?.detail?.toLowerCase().includes("no model")) throw new Error("NO_MODEL_LOADED");
      } catch (e) {
        if (e instanceof Error && e.message === "NO_MODEL_LOADED") throw e;
      }
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json() as ChatResponse;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from model");
  return content;
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

async function handleDmMessage(message: Message): Promise<void> {
  if (isGenerating) {
    await message.reply("⏳ Already generating, please wait...");
    return;
  }
  isGenerating = true;

  let placeholder: Message;
  try {
    placeholder = await sendInitialMessage(message.channel);
  } catch (err) {
    logger.error({ err }, "Failed to send placeholder message");
    isGenerating = false;
    return;
  }

  try {
    const reply = await fetchChatResponse(message.content);
    const chunks = splitIntoChunks(reply);
    await editMessage(placeholder, chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await sendNewMessage(message.channel, chunks[i]);
    }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error({ err }, "Inference error");
    if (e.message === "NO_MODEL_LOADED") {
      await editMessage(placeholder, "⚠️ No model loaded in EchoHub. Please load a model first.");
    } else {
      await editMessage(placeholder, `⚠️ Error: ${e.message}`);
    }
  } finally {
    isGenerating = false;
  }
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
