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
  provider: "claude" | "copilot" | "glm";
  model: string;
  systemPrompt: string | string[];
  permissions: "full-access" | "read-only";
  env?: Record<string, string>;
  executablePath?: string;
}

export interface AppConfig {
  humanName?: string;
  humanTag?: string;
  maxAutoHops?: number | "unlimited";
  agents: PersonaConfig[];
}
