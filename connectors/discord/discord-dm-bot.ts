// Discord DM bot — state machine EchoHub, navigation conversations, streaming SSE
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
  ButtonInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  Interaction,
} from "discord.js";
import pino from "pino";
import {
  apiGet,
  apiPost,
  buildActionRow,
  BotSession,
  ToolCallEntry,
  ConversationSummary,
  ConversationDbMessage,
  getActiveProfile,
} from "./discord-api-helpers";
import {
  streamChatSSE,
  scheduleEmbedEdit,
  finishStream,
  onStreamError,
  StreamState,
  StreamCallbacks,
  SSEToolEvent,
  CURSOR,
} from "./discord-stream-helpers";
import {
  buildHistoryEmbed,
  buildToolsEmbed,
  showProfileSelector,
  showMenuViaUpdate,
} from "./discord-embed-helpers";

// --- Config ---
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? "";
const DISCORD_AUTHORIZED_USER_ID = process.env.DISCORD_AUTHORIZED_USER_ID ?? "";

const EMBED_COLOR = 0x5865f2;
const HISTORY_LIMIT = 40;

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

const session: BotSession = {
  state: "idle",
  activeConvId: null,
  activeConvTitle: "New Chat",
  conversationHistory: [],
  toolCallsLog: [],
  activeProfileId: "default",
};

let isGenerating = false;

const setGenerating = (v: boolean): void => { isGenerating = v; };

// --- Logger ---
const logger = pino({
  transport: { target: "pino-pretty", options: { colorize: true } },
});

// --- Validation ---
function validateEnv(): void {
  if (!DISCORD_BOT_TOKEN) { logger.error("Missing DISCORD_BOT_TOKEN"); process.exit(1); }
  if (!DISCORD_AUTHORIZED_USER_ID) { logger.error("Missing DISCORD_AUTHORIZED_USER_ID"); process.exit(1); }
}

// ---------------------------------------------------------------------------
// Embed helpers
// ---------------------------------------------------------------------------

type SendableChannel = { send: (opts: object) => Promise<Message> };

function buildEmbed(description: string, done: boolean): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(done ? EMBED_COLOR : 0x36393f)
    .setDescription(description || CURSOR);
}

async function editEmbed(msg: Message, description: string, done: boolean): Promise<void> {
  try { await msg.edit({ embeds: [buildEmbed(description, done)] }); }
  catch (err) { logger.warn({ err }, "embed edit failed"); }
}

async function sendEmbedPlaceholder(channel: Message["channel"]): Promise<Message> {
  return (channel as unknown as SendableChannel).send({ embeds: [buildEmbed(CURSOR, false)] });
}

// ---------------------------------------------------------------------------
// Action rows
// ---------------------------------------------------------------------------

function buildResponseActionRow(): ActionRowBuilder<ButtonBuilder> {
  return buildActionRow("echohub_menu", "echohub_history", "echohub_tools", "echohub_profile");
}

function buildMenuActionRow(): ActionRowBuilder<ButtonBuilder> {
  return buildActionRow("echohub_convlist", "echohub_new_chat", "echohub_profile");
}

function buildBackActionRow(): ActionRowBuilder<ButtonBuilder> {
  return buildActionRow("echohub_back");
}

// ---------------------------------------------------------------------------
// Session startup — load or create conversation
// ---------------------------------------------------------------------------

async function createNewConversation(titlePrefix: string): Promise<void> {
  const title = `${titlePrefix} ${Date.now()}`;
  try {
    const created = await apiPost<{ id: string; title: string }>("/conversations", {
      id: crypto.randomUUID(),
      title,
    });
    session.activeConvId = created.id;
    session.activeConvTitle = created.title;
    session.conversationHistory = [];
    session.state = "chatting";
    logger.info({ convId: created.id }, "Created new conversation");
  } catch (err) { logger.error({ err }, "createNewConversation failed"); }
}

async function initSession(): Promise<void> {
  try {
    const list = await apiGet<ConversationSummary[]>("/conversations");
    if (list.length > 0) {
      session.activeConvId = list[0].id;
      session.activeConvTitle = list[0].title;
      session.state = "chatting";
      logger.info({ convId: list[0].id }, "Resuming existing conversation");
    } else {
      await createNewConversation("Discord Chat");
    }
  } catch (err) { logger.error({ err }, "initSession failed"); }
}

// ---------------------------------------------------------------------------
// handleChat — streams via /connectors/discord/chat
// ---------------------------------------------------------------------------

function recordToolEvent(
  event: SSEToolEvent,
  pending: Map<string, Partial<ToolCallEntry>>,
): void {
  if (event.type === "tool_call") {
    const id = crypto.randomUUID();
    pending.set(event.name ?? id, {
      id, timestamp: new Date().toISOString(),
      tool: event.name ?? "unknown",
      input: event.data.slice(0, 200),
      convId: session.activeConvId ?? "",
    });
    return;
  }
  if (event.type === "tool_result") {
    const key = event.tool ?? "";
    const p = pending.get(key);
    if (!p) return;
    session.toolCallsLog.push({
      id: p.id ?? crypto.randomUUID(),
      timestamp: p.timestamp ?? new Date().toISOString(),
      tool: p.tool ?? key,
      input: p.input ?? "",
      output: event.data.slice(0, 200),
      convId: p.convId ?? "",
    });
    pending.delete(key);
  }
}

function pushToHistory(role: "user" | "assistant", content: string): void {
  session.conversationHistory.push({ role, content });
  if (session.conversationHistory.length > HISTORY_LIMIT) {
    session.conversationHistory = session.conversationHistory.slice(-HISTORY_LIMIT);
  }
}

async function handleChat(message: Message): Promise<void> {
  if (isGenerating) { await message.reply("⏳ Already generating, please wait..."); return; }
  if (!session.activeConvId) {
    await createNewConversation("Discord Chat");
    if (!session.activeConvId) { await message.reply("⚠️ Failed to create conversation."); return; }
  }
  isGenerating = true;
  pushToHistory("user", message.content);
  let placeholder: Message;
  try {
    placeholder = await sendEmbedPlaceholder(message.channel);
  } catch (err) {
    logger.error({ err }, "Failed to send embed placeholder");
    isGenerating = false;
    return;
  }
  const state: StreamState = { accumulated: "", lastEdit: Date.now(), editTimer: null, settled: false };
  const pending = new Map<string, Partial<ToolCallEntry>>();
  const cbs: StreamCallbacks = {
    buildEmbed, buildResponseActionRow, editEmbed,
    onAssistantContent: (content) => pushToHistory("assistant", content),
    setGenerating,
    onToolEvent: (ev) => recordToolEvent(ev, pending),
  };
  const activeProfile = getActiveProfile(session);
  streamChatSSE(
    {
      conv_id: session.activeConvId,
      messages: session.conversationHistory,
      user_message_id: crypto.randomUUID(),
      temperature: activeProfile.temperature,
      max_tokens: 2048,
      system_prompt: activeProfile.systemPrompt,
    },
    (token) => { state.accumulated += token; scheduleEmbedEdit(state, placeholder, editEmbed); },
    () => { void finishStream(state, placeholder, message.channel, cbs); },
    (err) => { void onStreamError(state, err, placeholder, cbs); },
    cbs.onToolEvent,
  );
}

// ---------------------------------------------------------------------------
// Menu + Navigation
// ---------------------------------------------------------------------------

async function showMenu(channel: Message["channel"]): Promise<void> {
  session.state = "menu";
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle("☰ EchoHub")
    .setDescription(`**Active:** ${session.activeConvTitle}\n\nChoose an action:`);
  try {
    await (channel as unknown as SendableChannel).send({ embeds: [embed], components: [buildMenuActionRow()] });
  } catch (err) { logger.error({ err }, "showMenu failed"); }
}

async function showConvList(interaction: ButtonInteraction): Promise<void> {
  // update() immediately acknowledges the interaction — no timeout risk
  try {
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setTitle("💬 Conversations").setDescription("Loading…")],
      components: [],
    });
  } catch (err) { logger.error({ err }, "showConvList update failed"); return; }
  session.state = "conv_list";
  let list: ConversationSummary[];
  try { list = await apiGet<ConversationSummary[]>("/conversations"); }
  catch (err) {
    logger.error({ err }, "Failed to fetch conversations");
    try { await interaction.message.edit({ content: "⚠️ Failed to load conversations.", embeds: [], components: [] }); } catch { /* ignore */ }
    return;
  }
  const options = list.slice(0, 10).map((c) => ({
    label: c.title.slice(0, 100),
    value: c.id,
    description: `${c.message_count} msgs · ${new Date(c.updated_at).toLocaleDateString()}`,
  }));
  const select = new StringSelectMenuBuilder().setCustomId("echohub_conv_select")
    .setPlaceholder("Select a conversation…")
    .addOptions(options.length > 0 ? options : [{ label: "No conversations", value: "none" }]);
  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle("💬 Conversations")
    .setDescription(`${list.length} conversation(s)`);
  try {
    await interaction.message.edit({ embeds: [embed], components: [selectRow, buildBackActionRow()] });
  } catch (err) { logger.error({ err }, "showConvList message.edit failed"); }
}

async function loadConversation(convId: string, channel: Message["channel"]): Promise<void> {
  try {
    const [msgs, allConvs] = await Promise.all([
      apiGet<ConversationDbMessage[]>(`/conversations/${convId}/messages`),
      apiGet<ConversationSummary[]>("/conversations"),
    ]);
    const found = allConvs.find((c) => c.id === convId);
    session.activeConvId = convId;
    session.activeConvTitle = found?.title ?? "Conversation";
    session.conversationHistory = msgs
      .filter((m): m is ConversationDbMessage & { role: "user" | "assistant" } =>
        m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    session.state = "chatting";
    const embed = new EmbedBuilder().setColor(EMBED_COLOR)
      .setDescription(`✅ Loaded **${session.activeConvTitle}** (${session.conversationHistory.length} messages)`);
    await (channel as unknown as SendableChannel).send({
      embeds: [embed],
      components: [buildActionRow("echohub_menu", "echohub_history")],
    });
  } catch (err) { logger.error({ err }, "loadConversation failed"); }
}

async function handleNewChat(channel: Message["channel"]): Promise<void> {
  await createNewConversation("Discord Chat");
  try {
    const embed = new EmbedBuilder().setColor(EMBED_COLOR).setDescription("✨ New conversation started.");
    await (channel as unknown as SendableChannel).send({
      embeds: [embed],
      components: [buildActionRow("echohub_menu", "echohub_history")],
    });
  } catch (err) { logger.error({ err }, "handleNewChat send failed"); }
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

async function executeClear(channel: Message["channel"], clientUserId: string | undefined): Promise<void> {
  session.conversationHistory = [];
  const fetched = await channel.messages.fetch({ limit: 50 });
  const botMessages = fetched.filter((msg) => msg.author.id === clientUserId);
  for (const [, msg] of botMessages) {
    try { await msg.delete(); await new Promise<void>((resolve) => setTimeout(resolve, 300)); }
    catch (err) { logger.warn({ err }, "failed to delete bot message"); }
  }
  try {
    await (channel as unknown as SendableChannel).send({
      content: "🗑️ Conversation cleared.",
      components: [buildActionRow("echohub_convlist", "echohub_new_chat")],
    });
  } catch (err) { logger.warn({ err }, "clear send failed"); }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleCommand(message: Message, client: Client): Promise<void> {
  const cmd = message.content.trim().toLowerCase();
  if (cmd === "!clear") {
    try { await executeClear(message.channel, client.user?.id); }
    catch (err) { logger.error({ err }, "!clear failed"); }
    return;
  }
  if (cmd === "!help") {
    const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle("Echo — Commands")
      .setDescription("**Chat** — Just type\n**!clear** — Reset history\n**!resume** — Last 10 exchanges\n**!menu** — Navigation menu\n**!help** — This help");
    try {
      await (message.channel as unknown as SendableChannel).send({
        embeds: [embed],
        components: [buildActionRow("echohub_menu", "echohub_history", "echohub_tools")],
      });
    }
    catch (err) { logger.error({ err }, "!help failed"); }
    return;
  }
  if (cmd === "!resume") {
    try {
      await (message.channel as unknown as SendableChannel).send({
        embeds: [buildHistoryEmbed(session.conversationHistory)],
        components: [buildActionRow("echohub_menu", "echohub_tools")],
      });
    }
    catch (err) { logger.error({ err }, "!resume failed"); }
    return;
  }
  if (cmd === "!menu") { await showMenu(message.channel); }
}

// ---------------------------------------------------------------------------
// Interaction handlers
// ---------------------------------------------------------------------------


async function handleButtonInteraction(interaction: ButtonInteraction, client: Client): Promise<void> {
  if (interaction.user.id !== DISCORD_AUTHORIZED_USER_ID) {
    try { await interaction.reply({ content: "Unauthorized.", ephemeral: true }); }
    catch (err) { logger.warn({ err }, "unauthorized interaction reply failed"); }
    return;
  }
  const channel = interaction.channel ?? interaction.message.channel;
  const id = interaction.customId;

  // convlist, profile and menu use interaction.update()/reply() directly — no defer needed
  if (id === "echohub_convlist") { await showConvList(interaction); return; }
  if (id === "echohub_profile") { await showProfileSelector(interaction, session); return; }
  if (id === "echohub_menu") { await showMenuViaUpdate(interaction, session.activeConvTitle, buildMenuActionRow); return; }
  if (id === "echohub_back") { await showMenuViaUpdate(interaction, session.activeConvTitle, buildMenuActionRow); return; }

  // All other buttons: deferUpdate first, then act via channel.send
  try { await interaction.deferUpdate(); } catch { /* already deferred */ }

  if (id === "echohub_clear") {
    try { await executeClear(channel, client.user?.id); } catch (err) { logger.error({ err }, "button clear failed"); }
  } else if (id === "echohub_new_chat") {
    await handleNewChat(channel);
  } else if (id === "echohub_history") {
    try {
      await (channel as unknown as SendableChannel).send({
        embeds: [buildHistoryEmbed(session.conversationHistory)],
        components: [buildActionRow("echohub_menu", "echohub_tools")],
      });
    } catch (err) { logger.error({ err }, "button history failed"); }
  } else if (id === "echohub_tools") {
    try {
      await (channel as unknown as SendableChannel).send({
        embeds: [buildToolsEmbed(session.toolCallsLog)],
        components: [buildActionRow("echohub_menu", "echohub_history")],
      });
    } catch (err) { logger.error({ err }, "button tools failed"); }
  }
}

async function handleProfileSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const profileId = interaction.values[0];
  if (!profileId) return;
  session.activeProfileId = profileId;
  const profile = getActiveProfile(session);
  try {
    await interaction.update({
      embeds: [new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("⚙️ Profile changed")
        .setDescription(`**${profile.name}** — temp: ${profile.temperature}`)],
      components: [buildActionRow("echohub_menu", "echohub_history")],
    });
  } catch (err) { logger.error({ err }, "handleProfileSelect update failed"); }
}

async function handleSelectInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.user.id !== DISCORD_AUTHORIZED_USER_ID) {
    try { await interaction.reply({ content: "Unauthorized.", ephemeral: true }); }
    catch (err) { logger.warn({ err }, "unauthorized select reply failed"); }
    return;
  }
  if (interaction.customId === "echohub_profile_select") {
    await handleProfileSelect(interaction);
    return;
  }
  if (interaction.customId !== "echohub_conv_select") return;
  const selected = interaction.values[0];
  if (!selected || selected === "none") return;
  try { await interaction.deferUpdate(); } catch { /* already deferred */ }
  await loadConversation(selected, interaction.channel ?? interaction.message.channel);
}

// ---------------------------------------------------------------------------
// Client setup
// ---------------------------------------------------------------------------

function createClient(): Client {
  return new Client({ intents: [GatewayIntentBits.DirectMessages], partials: [Partials.Channel, Partials.Message, Partials.User] });
}

function registerClientEvents(client: Client): void {
  client.once(Events.ClientReady, (c) => {
    logger.info({ username: c.user.tag, clientId: DISCORD_CLIENT_ID }, "Discord bot ready");
    void initSession();
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (message.channel.type !== ChannelType.DM) return;
    if (message.author.id !== DISCORD_AUTHORIZED_USER_ID) return;
    logger.info({ content: message.content.slice(0, 80) }, "DM received");
    if (message.content.startsWith("!")) { await handleCommand(message, client); return; }
    if (session.state === "chatting" || session.state === "idle") { await handleChat(message); return; }
    // menu / conv_list — navigation par boutons uniquement
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isButton()) { await handleButtonInteraction(interaction, client); return; }
      if (interaction.isStringSelectMenu()) { await handleSelectInteraction(interaction); return; }
    } catch (err) { logger.error({ err }, "interaction handler failed"); }
  });

  client.on(Events.Error, (err: Error) => {
    logger.error({ err }, "Discord client error");
    if (err.message.toLowerCase().includes("token")) { process.exit(1); }
  });
}

// --- Graceful shutdown ---
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
