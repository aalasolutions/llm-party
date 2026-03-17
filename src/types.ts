export type Actor = string;

export interface ConversationMessage {
  id: number;
  from: Actor;
  text: string;
  createdAt: string;
}

export interface PersonaConfig {
  name: string;
  tag?: string;
  provider: "claude" | "copilot" | "codex" | "glm";
  model: string;
  systemPrompt: string | string[];
  env?: Record<string, string>;
  executablePath?: string;
}

export interface AppConfig {
  humanName?: string;
  humanTag?: string;
  maxAutoHops?: number | "unlimited";
  agents: PersonaConfig[];
}
