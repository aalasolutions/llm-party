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
  maxAutoHops?: number | "unlimited";
  timeout?: number;
  agents: PersonaConfig[];
}

export type MessageType = "user" | "agent" | "system";

export interface DisplayMessage extends ConversationMessage {
  type: MessageType;
  provider?: string;
}
