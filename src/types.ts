export type Actor = string;

export interface ConversationMessage {
  id: number;
  from: Actor;
  text: string;
  createdAt: string;
}

export interface PersonaConfig {
  name: string;
  tag: string;
  provider: "claude" | "copilot" | "codex" | "custom";
  cli?: "claude" | "codex" | "copilot";
  model: string;
  active?: boolean;
  prompts?: string[];
  preloadSkills?: string[];
  resolvedPrompt?: string;
  env?: Record<string, string>;
  executablePath?: string;
  timeout?: number;
}

export interface AppConfig {
  humanName?: string;
  humanTag?: string;
  maxAutoHops?: number;
  timeout?: number;
  reminderInterval?: number;
  agents: PersonaConfig[];
}

export type MessageType = "user" | "agent" | "system";

export interface DisplayMessage extends ConversationMessage {
  type: MessageType;
  provider?: string;
  tag?: string;
}

export type AgentActivity =
  | "idle"
  | "queued"
  | "thinking"
  | "reading"
  | "writing"
  | "running"
  | "searching"
  | "error";

export type AgentEvent =
  | { type: "activity"; activity: AgentActivity; detail?: string }
  | { type: "response"; text: string }
  | { type: "error"; message: string };

export interface AgentActivityEntry {
  ts: string;
  activity: AgentActivity;
  detail?: string;
}

export interface QueuedMessage {
  from: string;
  text: string;
  queuedAt: string;
  chainHops: number;
}
