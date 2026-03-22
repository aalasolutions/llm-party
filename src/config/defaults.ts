import type { PersonaConfig } from "../types.js";

export interface ProviderDef {
  id: PersonaConfig["provider"];
  displayName: string;
  description: string;
  unavailableHint: string;
  defaultModel: string;
  defaultTag: string;
  detectCommand: string;
  detectType: "binary" | "alias";
  env?: Record<string, string>;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "claude",
    displayName: "Claude",
    description: "Anthropic Claude Agent SDK",
    unavailableHint: "claude CLI not found",
    defaultModel: "sonnet",
    defaultTag: "claude",
    detectCommand: "claude",
    detectType: "binary",
  },
  {
    id: "codex",
    displayName: "Codex",
    description: "OpenAI Codex SDK",
    unavailableHint: "codex CLI not found",
    defaultModel: "gpt-5.2",
    defaultTag: "codex",
    detectCommand: "codex",
    detectType: "binary",
  },
  {
    id: "copilot",
    displayName: "Copilot",
    description: "GitHub Copilot SDK",
    unavailableHint: "copilot CLI not found",
    defaultModel: "gpt-4.1",
    defaultTag: "copilot",
    detectCommand: "copilot",
    detectType: "binary",
  },
  {
    id: "glm",
    displayName: "GLM",
    description: "glm alias configured on Claude Code CLI",
    unavailableHint: "glm shell alias not configured",
    defaultModel: "glm-5",
    defaultTag: "glm",
    detectCommand: "glm",
    detectType: "alias",
    env: {
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.5-air",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-4.5",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5",
    },
  },
];
