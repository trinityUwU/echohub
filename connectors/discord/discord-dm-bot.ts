// Discord DM bot — streaming SSE via http.request (Node compat), embed Discord, strip thinking
import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  Message,
  EmbedBuilder,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
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
const HISTORY_LIMIT = 40; // max messages kept in conversationHistory
const RESUME_LIMIT = 20; // last N items shown in !resume (= 10 exchanges)
const RESUME_TRUNCATE = 300; // max chars per message in !resume embed

// ---------------------------------------------------------------------------
// Conversation history
// ---------------------------------------------------------------------------

interface ConversationMessage { role: "user" | "assistant"; content: string }
let conversationHistory: ConversationMessage[] = [];

function pushToHistory(msg: ConversationMessage): void {
  conversationHistory.push(msg);
  if (conversationHistory.length > HISTORY_LIMIT) {
    conversationHistory = conversationHistory.slice(-HISTORY_LIMIT);
  }
}

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

function buildResponseActionRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("echohub_clear")
      .setLabel("Clear")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🗑️"),
    new ButtonBuilder()
      .setCustomId("echohub_history")
      .setLabel("History")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📝"),
  );
}

// ---------------------------------------------------------------------------
// SSE streaming via http.request (Node-compat, no ReadableStream)
// ---------------------------------------------------------------------------

let isGenerating = false;

function streamChatSSE(
  messages: ConversationMessage[],
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: Error) => void
): void {
  const url = new URL(`${ECHOHUB_API_URL}/inference/chat`);
  const body = JSON.stringify({
    messages,
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
// Command helpers
// ---------------------------------------------------------------------------

function truncateMessage(text: string): string {
  return text.length > RESUME_TRUNCATE ? text.slice(0, RESUME_TRUNCATE) + "…" : text;
}

async function buildHistoryEmbed(): Promise<EmbedBuilder> {
  const slice = conversationHistory.slice(-RESUME_LIMIT);
  let description = "No conversation history yet.";
  if (slice.length > 0) {
    description = slice
      .map((m) => {
        const prefix = m.role === "user" ? "**You:**" : "**Echo:**";
        return `${prefix} ${truncateMessage(m.content)}`;
      })
      .join("\n\n");
  }
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("📝 Conversation History")
    .setDescription(description);
}

type SendableChannel = { send: (text: string) => Promise<Message>; messages: Message["channel"]["messages"] };

async function executeClear(channel: Message["channel"], clientUserId: string | undefined): Promise<void> {
  conversationHistory = [];
  const fetched = await channel.messages.fetch({ limit: 50 });
  const botMessages = fetched.filter((msg) => msg.author.id === clientUserId);
  for (const [, msg] of botMessages) {
    try {
      await msg.delete();
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
    } catch (err) { logger.warn({ err }, "failed to delete bot message"); }
  }
  await (channel as unknown as SendableChannel).send("🗑️ Conversation cleared.");
}

async function handleClearCommand(message: Message, client: Client): Promise<void> {
  try {
    await executeClear(message.channel, client.user?.id);
  } catch (err) {
    logger.error({ err }, "!clear failed");
  }
}

async function handleHelpCommand(message: Message): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("Echo — Commands")
    .setDescription(
      "**Chat** — Just type your message\n" +
      "**!clear** — Reset conversation history and delete bot messages\n" +
      "**!resume** — Show last 10 exchanges from current history\n" +
      "**!help** — Show this help\n\n" +
      "You can also use the buttons below any response."
    );
  try {
    await (message.channel as { send: (opts: object) => Promise<Message> })
      .send({ embeds: [embed], components: [buildResponseActionRow()] });
  } catch (err) { logger.error({ err }, "!help failed"); }
}

async function handleResumeCommand(message: Message): Promise<void> {
  try {
    const embed = await buildHistoryEmbed();
    await (message.channel as { send: (opts: object) => Promise<Message> })
      .send({ embeds: [embed] });
  } catch (err) { logger.error({ err }, "!resume failed"); }
}

async function handleCommand(message: Message, client: Client): Promise<void> {
  const cmd = message.content.trim().toLowerCase();
  if (cmd === "!clear") { await handleClearCommand(message, client); return; }
  if (cmd === "!help") { await handleHelpCommand(message); return; }
  if (cmd === "!resume") { await handleResumeCommand(message); return; }
  // Unknown command — silently ignore
}

// ---------------------------------------------------------------------------
// DM handling with streaming embed
// ---------------------------------------------------------------------------

interface StreamState {
  accumulated: string;
  lastEdit: number;
  editTimer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

async function finishStream(state: StreamState, placeholder: Message, channel: Message["channel"]): Promise<void> {
  if (state.settled) return;
  state.settled = true;
  if (state.editTimer) { clearTimeout(state.editTimer); state.editTimer = null; }
  isGenerating = false;
  const final = stripThinkingBlocks(state.accumulated);
  if (!final) { await editEmbed(placeholder, "*(no response)*", true); return; }
  pushToHistory({ role: "assistant", content: final });
  const row = buildResponseActionRow();
  if (final.length <= MAX_EMBED_LENGTH) {
    try { await placeholder.edit({ embeds: [buildEmbed(final, true)], components: [row] }); }
    catch (err) { logger.warn({ err }, "embed edit with buttons failed"); }
    return;
  }
  await editEmbed(placeholder, final.slice(0, MAX_EMBED_LENGTH), true);
  let remaining = final.slice(MAX_EMBED_LENGTH);
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, MAX_EMBED_LENGTH);
    remaining = remaining.slice(MAX_EMBED_LENGTH);
    try {
      await (channel as { send: (opts: object) => Promise<Message> })
        .send({ embeds: [buildEmbed(chunk, true)], components: remaining.length === 0 ? [row] : [] });
    } catch (err) { logger.warn({ err }, "embed send chunk failed"); }
  }
}

async function onStreamError(state: StreamState, err: Error, placeholder: Message): Promise<void> {
  if (state.settled) return;
  state.settled = true;
  if (state.editTimer) { clearTimeout(state.editTimer); state.editTimer = null; }
  isGenerating = false;
  logger.error({ err }, "Inference error");
  const msg = err.message === "NO_MODEL_LOADED"
    ? "⚠️ No model loaded in EchoHub. Please load a model first."
    : `⚠️ ${err.message}`;
  await editEmbed(placeholder, msg, false);
}

function scheduleEmbedEdit(state: StreamState, placeholder: Message): void {
  if (state.editTimer || state.settled) return;
  const delay = Math.max(0, EDIT_THROTTLE_MS - (Date.now() - state.lastEdit));
  state.editTimer = setTimeout(async () => {
    state.editTimer = null;
    state.lastEdit = Date.now();
    const visible = stripThinkingBlocks(state.accumulated);
    await editEmbed(placeholder, (visible || CURSOR) + CURSOR, false);
  }, delay);
}

async function handleDmMessage(message: Message): Promise<void> {
  if (isGenerating) { await message.reply("⏳ Already generating, please wait..."); return; }
  isGenerating = true;
  let placeholder: Message;
  try {
    placeholder = await sendEmbedPlaceholder(message.channel);
  } catch (err) {
    logger.error({ err }, "Failed to send embed placeholder");
    isGenerating = false;
    return;
  }
  const state: StreamState = { accumulated: "", lastEdit: Date.now(), editTimer: null, settled: false };
  const onToken = (token: string): void => { state.accumulated += token; scheduleEmbedEdit(state, placeholder); };
  const onDone = (): void => { void finishStream(state, placeholder, message.channel); };
  const onError = (err: Error): void => { void onStreamError(state, err, placeholder); };
  pushToHistory({ role: "user", content: message.content });
  streamChatSSE(conversationHistory, onToken, onDone, onError);
}

// ---------------------------------------------------------------------------
// Button interaction handler
// ---------------------------------------------------------------------------

async function handleButtonInteraction(interaction: ButtonInteraction, client: Client): Promise<void> {
  if (interaction.user.id !== DISCORD_AUTHORIZED_USER_ID) {
    try {
      await interaction.reply({ content: "Unauthorized.", ephemeral: true });
    } catch (err) { logger.warn({ err }, "unauthorized interaction reply failed"); }
    return;
  }

  if (interaction.customId === "echohub_clear") {
    try {
      await interaction.deferUpdate();
      await executeClear(interaction.channel ?? interaction.message.channel, client.user?.id);
    } catch (err) { logger.error({ err }, "button clear failed"); }
    return;
  }

  if (interaction.customId === "echohub_history") {
    try {
      const embed = await buildHistoryEmbed();
      await interaction.reply({ embeds: [embed] });
    } catch (err) { logger.error({ err }, "button history failed"); }
    return;
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
    logger.info({ content: message.content.slice(0, 80) }, "DM received");
    if (message.content.startsWith("!")) {
      await handleCommand(message, client);
      return;
    }
    await handleDmMessage(message);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    await handleButtonInteraction(interaction, client);
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
