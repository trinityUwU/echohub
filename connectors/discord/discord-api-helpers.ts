// Helpers API EchoHub pour le bot Discord — types session, apiGet, apiPost, buildActionRow, profils chat
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
  activeProfileId: string;
}

// ---------------------------------------------------------------------------
// Chat profiles
// ---------------------------------------------------------------------------

export interface ChatProfile {
  id: string;
  name: string;
  systemPrompt: string;
  temperature: number;
}

export const CHAT_PROFILES: ChatProfile[] = [
  {
    id: "default",
    name: "Default",
    temperature: 0.6,
    systemPrompt: "You are a direct, competent assistant. Answer accurately and concisely. No filler, no flattery, no unnecessary caveats. Always reply in the exact language the user writes in — switch instantly if they switch.",
  },
  {
    id: "precise",
    name: "Precise",
    temperature: 0.2,
    systemPrompt: "You are a precision-focused assistant. Prioritize correctness over completeness. When uncertain, state your confidence level explicitly. Never fill gaps with plausible-sounding approximations. Always reply in the exact language the user writes in — switch instantly if they switch.",
  },
  {
    id: "creative",
    name: "Creative",
    temperature: 1.0,
    systemPrompt: "You are an expansive, associative thinker. Generate original ideas, unexpected angles, and divergent perspectives. Push past the obvious answer. Always reply in the exact language the user writes in — switch instantly if they switch.",
  },
  {
    id: "balanced",
    name: "Balanced",
    temperature: 0.7,
    systemPrompt: "You are a clear-headed analyst. Balance depth with concision. Structure your reasoning before outputting conclusions. Suited for tradeoffs, multi-part problems, and technical decisions. Always reply in the exact language the user writes in — switch instantly if they switch.",
  },
  {
    id: "coder",
    name: "Coder",
    temperature: 0.3,
    systemPrompt: "You are a senior software engineer. Write working code. Think in systems. Spot edge cases before they are asked. Default stack: Python, TypeScript, React, FastAPI, Bun, SQLite, Tailwind. Always reply in the exact language the user writes in — switch instantly if they switch.",
  },
];

export function getActiveProfile(session: BotSession): ChatProfile {
  return CHAT_PROFILES.find((p) => p.id === session.activeProfileId) ?? CHAT_PROFILES[0];
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function buildRequestOptions(url: URL, method: string, bodyStr?: string): http.RequestOptions {
  return {
    hostname: url.hostname,
    port: parseInt(url.port) || (url.protocol === "https:" ? 443 : 80),
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
  "echohub_profile":  { label: "Profile",        style: ButtonStyle.Secondary, emoji: "⚙" },
  "echohub_convlist": { label: "Conversations",  style: ButtonStyle.Primary,   emoji: "💬" },
  "echohub_new_chat": { label: "New Chat",       style: ButtonStyle.Success,   emoji: "➕" },
  "echohub_clear":    { label: "Clear",          style: ButtonStyle.Danger,    emoji: "🗑" },
  "echohub_back":     { label: "Back to Menu",   style: ButtonStyle.Secondary, emoji: "↩️" },
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
