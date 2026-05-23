// Helpers API EchoHub pour le bot Discord — types session, apiGet, apiPost, buildActionRow
import http from "http";
import https from "https";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

const ECHOHUB_API_URL = process.env.ECHOHUB_API_URL ?? "http://localhost:37821";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationMessage { role: "user" | "assistant"; content: string }

export interface ToolCallEntry {
  id: string;
  timestamp: string;
  tool: string;
  input: string;
  output: string;
  convId: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  model_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface ConversationDbMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export type BotState = "idle" | "chatting" | "menu" | "conv_list"

export interface BotSession {
  state: BotState;
  activeConvId: string | null;
  activeConvTitle: string;
  conversationHistory: ConversationMessage[];
  toolCallsLog: ToolCallEntry[];
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function buildRequestOptions(url: URL, method: string, bodyStr?: string): http.RequestOptions {
  return {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname,
    method,
    headers: {
      "Content-Type": "application/json",
      ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
    },
  };
}

function httpRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${ECHOHUB_API_URL}${path}`);
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(buildRequestOptions(url, method, bodyStr), (res) => {
      let raw = "";
      res.on("data", (c: Buffer) => { raw += c.toString(); });
      res.on("end", () => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        } else {
          resolve(raw);
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export async function apiGet<T>(path: string): Promise<T> {
  const raw = await httpRequest("GET", path);
  return JSON.parse(raw) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const raw = await httpRequest("POST", path, body);
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Button helpers
// ---------------------------------------------------------------------------

interface ButtonDef { label: string; style: ButtonStyle; emoji: string }

const BUTTON_DEFS: Record<string, ButtonDef> = {
  "echohub_menu":     { label: "Menu",          style: ButtonStyle.Secondary, emoji: "📋" },
  "echohub_history":  { label: "History",        style: ButtonStyle.Secondary, emoji: "📝" },
  "echohub_tools":    { label: "Tools",          style: ButtonStyle.Secondary, emoji: "⚡" },
  "echohub_convlist": { label: "Conversations",  style: ButtonStyle.Primary,   emoji: "💬" },
  "echohub_new_chat": { label: "New Chat",       style: ButtonStyle.Success,   emoji: "➕" },
  "echohub_clear":    { label: "Clear",          style: ButtonStyle.Danger,    emoji: "🗑️" },
  "echohub_back":     { label: "Back to Menu",   style: ButtonStyle.Secondary, emoji: "←" },
};

export function buildActionRow(...buttonIds: string[]): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const id of buttonIds) {
    const def = BUTTON_DEFS[id];
    if (!def) continue;
    row.addComponents(
      new ButtonBuilder().setCustomId(id).setLabel(def.label).setStyle(def.style).setEmoji(def.emoji),
    );
  }
  return row;
}
