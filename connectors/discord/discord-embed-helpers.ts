// Builders d'embeds et de sélecteurs pour le bot Discord — history, tools, profile selector
import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  Message,
} from "discord.js";
import pino from "pino";
import {
  BotSession,
  ToolCallEntry,
  ConversationMessage,
  CHAT_PROFILES,
  getActiveProfile,
  buildActionRow,
} from "./discord-api-helpers";

const EMBED_COLOR = 0x5865f2;
const RESUME_LIMIT = 20;
const RESUME_TRUNCATE = 300;

const logger = pino({
  transport: { target: "pino-pretty", options: { colorize: true } },
});

type SendableChannel = { send: (opts: object) => Promise<Message> };

// ---------------------------------------------------------------------------
// History embed
// ---------------------------------------------------------------------------

function truncateMessage(text: string): string {
  return text.length > RESUME_TRUNCATE ? text.slice(0, RESUME_TRUNCATE) + "…" : text;
}

export function buildHistoryEmbed(history: ConversationMessage[]): EmbedBuilder {
  const slice = history.slice(-RESUME_LIMIT);
  const description = slice.length > 0
    ? slice.map((m) => `${m.role === "user" ? "**You:**" : "**Echo:**"} ${truncateMessage(m.content)}`).join("\n\n")
    : "No conversation history yet.";
  return new EmbedBuilder().setColor(EMBED_COLOR).setTitle("📝 Conversation History").setDescription(description);
}

// ---------------------------------------------------------------------------
// Tool calls embed
// ---------------------------------------------------------------------------

function formatToolEntry(entry: ToolCallEntry): string {
  const ts = entry.timestamp.slice(11, 19);
  return `**[${ts}] ${entry.tool}**\n→ Input: \`${entry.input}\`\n→ Output: \`${entry.output}\``;
}

export function buildToolsEmbed(toolCallsLog: ToolCallEntry[]): EmbedBuilder {
  const entries = toolCallsLog.slice(-5);
  const description = entries.length > 0
    ? entries.map(formatToolEntry).join("\n\n")
    : "No tool calls in this session yet.";
  return new EmbedBuilder().setColor(EMBED_COLOR).setTitle("⚡ Tool Calls").setDescription(description);
}

// ---------------------------------------------------------------------------
// Profile selector
// ---------------------------------------------------------------------------

function buildProfileSelectRow(activeId: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = CHAT_PROFILES.map((p) => ({
    label: p.name + (p.id === activeId ? " ✓" : ""),
    value: p.id,
    description: `temp: ${p.temperature} — ${p.systemPrompt.slice(0, 50)}`,
    default: p.id === activeId,
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId("echohub_profile_select")
    .setPlaceholder("Select a profile…")
    .addOptions(options);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

export async function showProfileSelector(
  channel: Message["channel"],
  session: BotSession,
): Promise<void> {
  const profile = getActiveProfile(session);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("⚙️ Chat Profile")
    .setDescription(`**Active:** ${profile.name} (temp: ${profile.temperature})`);
  try {
    await (channel as unknown as SendableChannel).send({
      embeds: [embed],
      components: [buildProfileSelectRow(session.activeProfileId), buildActionRow("echohub_back")],
    });
  } catch (err) { logger.error({ err }, "showProfileSelector failed"); }
}
