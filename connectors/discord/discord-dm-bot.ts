// Discord DM bot — streaming SSE via http.request (Node compat), embed Discord, strip thinking
import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  Message,
  EmbedBuilder,
  Events,
} from "discord.js";
import http from "http";
import https from "https";
import pino from "pino";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? "";
const DISCORD_AUTHORIZED_USER_ID = process.env.DISCORD_AUTHORIZED_USER_ID ?? "";
const ECHOHUB_API_URL = process.env.ECHOHUB_API_URL ?? "http://localhost:37821";

const MAX_EMBED_LENGTH = 3900; // Discord embed description limit is 4096, keep margin
const EDIT_THROTTLE_MS = 800;
const CURSOR = "▍";
const EMBED_COLOR = 0x5865f2; // Discord blurple

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = pino({
  transport: { target: "pino-pretty", options: { colorize: true } },
});

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
  // Replace complete thinking blocks with separator
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, "\n\n---\n\n");
  // Remove orphaned opening <think> (generation in progress)
  out = out.replace(/<think>[\s\S]*/g, "");
  // Replace orphaned closing </think> with separator
  out = out.replace(/<\/think>/g, "\n\n---\n\n");
  return out.trim();
}

function parseSSEChunk(raw: string): string {
  // raw = "data: {...}\n\ndata: {...}\n\n..."
  let token = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const json = JSON.parse(line.slice(6)) as {
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
        done?: boolean;
        type?: string;
      };
      // echohub_stats / timings — skip
      if (json.type) continue;
      token += json.choices?.[0]?.delta?.content ?? "";
    } catch { /* partial chunk */ }
  }
  return token;
}

function isDone(raw: string): boolean {
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const json = JSON.parse(line.slice(6)) as { done?: boolean };
      if (json.done === true) return true;
    } catch { /* partial */ }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Discord embed helpers
// ---------------------------------------------------------------------------

function buildEmbed(description: string, done: boolean): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(done ? EMBED_COLOR : 0x36393f)
    .setDescription(description || CURSOR);
}

async function sendEmbedPlaceholder(channel: Message["channel"]): Promise<Message> {
  const embed = buildEmbed(CURSOR, false);
  return (channel as { send: (opts: object) => Promise<Message> })
    .send({ embeds: [embed] });
}

async function editEmbed(msg: Message, description: string, done: boolean): Promise<void> {
  try {
    const embed = buildEmbed(description, done);
    await msg.edit({ embeds: [embed] });
  } catch (err) { logger.warn({ err }, "embed edit failed"); }
}

async function sendNewEmbed(channel: Message["channel"], description: string): Promise<void> {
  try {
    const embed = buildEmbed(description, true);
    await (channel as { send: (opts: object) => Promise<Message> })
      .send({ embeds: [embed] });
  } catch (err) { logger.warn({ err }, "embed send failed"); }
}

// ---------------------------------------------------------------------------
// SSE streaming via http.request (Node-compat, no ReadableStream)
// ---------------------------------------------------------------------------

let isGenerating = false;

function streamChatSSE(
  userContent: string,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: Error) => void
): void {
  const url = new URL(`${ECHOHUB_API_URL}/inference/chat`);
  const body = JSON.stringify({
    messages: [{ role: "user", content: userContent }],
    stream: true,
    temperature: 0.7,
    max_tokens: 2048,
  });

  const transport = url.protocol === "https:" ? https : http;
  const req = transport.request(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Accept: "text/event-stream",
      },
    },
    (res) => {
      if (res.statusCode === 404) {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString(); });
        res.on("end", () => {
          try {
            const detail = (JSON.parse(raw) as { detail?: string }).detail ?? "";
            if (detail.toLowerCase().includes("no model")) {
              onError(new Error("NO_MODEL_LOADED")); return;
            }
          } catch { /* ignore */ }
          onError(new Error(`HTTP 404: Not Found`));
        });
        return;
      }
      if (!res.statusCode || res.statusCode >= 400) {
        onError(new Error(`HTTP ${res.statusCode}`)); return;
      }

      res.on("data", (chunk: Buffer) => {
        const raw = chunk.toString();
        if (isDone(raw)) { onDone(); return; }
        const token = parseSSEChunk(raw);
        if (token) onToken(token);
      });
      res.on("end", onDone);
      res.on("error", onError);
    }
  );
  req.on("error", onError);
  req.write(body);
  req.end();
}

// ---------------------------------------------------------------------------
// DM handling with streaming embed
// ---------------------------------------------------------------------------

async function handleDmMessage(message: Message): Promise<void> {
  if (isGenerating) {
    await message.reply("⏳ Already generating, please wait...");
    return;
  }
  isGenerating = true;

  let placeholder: Message;
  try {
    placeholder = await sendEmbedPlaceholder(message.channel);
  } catch (err) {
    logger.error({ err }, "Failed to send embed placeholder");
    isGenerating = false;
    return;
  }

  let accumulated = "";
  let lastEdit = Date.now();
  let editTimer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const scheduleEdit = (): void => {
    if (editTimer || settled) return;
    const delay = Math.max(0, EDIT_THROTTLE_MS - (Date.now() - lastEdit));
    editTimer = setTimeout(async () => {
      editTimer = null;
      lastEdit = Date.now();
      const visible = stripThinkingBlocks(accumulated);
      await editEmbed(placeholder, (visible || CURSOR) + CURSOR, false);
    }, delay);
  };

  const finish = async (): Promise<void> => {
    if (settled) return;
    settled = true;
    if (editTimer) { clearTimeout(editTimer); editTimer = null; }
    isGenerating = false;

    const final = stripThinkingBlocks(accumulated);
    if (!final) { await editEmbed(placeholder, "*(no response)*", true); return; }

    // Split if > MAX_EMBED_LENGTH
    if (final.length <= MAX_EMBED_LENGTH) {
      await editEmbed(placeholder, final, true);
    } else {
      await editEmbed(placeholder, final.slice(0, MAX_EMBED_LENGTH), true);
      let remaining = final.slice(MAX_EMBED_LENGTH);
      while (remaining.length > 0) {
        await sendNewEmbed(message.channel, remaining.slice(0, MAX_EMBED_LENGTH));
        remaining = remaining.slice(MAX_EMBED_LENGTH);
      }
    }
  };

  const onToken = (token: string): void => {
    accumulated += token;
    scheduleEdit();
  };

  const onDone = (): void => { void finish(); };

  const onError = async (err: Error): Promise<void> => {
    if (settled) return;
    settled = true;
    if (editTimer) { clearTimeout(editTimer); editTimer = null; }
    isGenerating = false;
    logger.error({ err }, "Inference error");
    const msg = err.message === "NO_MODEL_LOADED"
      ? "⚠️ No model loaded in EchoHub. Please load a model first."
      : `⚠️ ${err.message}`;
    await editEmbed(placeholder, msg, false);
  };

  streamChatSSE(message.content, onToken, onDone, (err) => { void onError(err); });
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
    logger.info({ content: message.content.slice(0, 80) }, "DM received");
    await handleDmMessage(message);
  });

  client.on(Events.Error, (err: Error) => {
    logger.error({ err }, "Discord client error");
    if (err.message.toLowerCase().includes("token")) { process.exit(1); }
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
