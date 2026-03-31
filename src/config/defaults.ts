import type { PersonaConfig } from "../types.js";

export interface ProviderDef {
  id: PersonaConfig["provider"];
  displayName: string;
  description: string;
  unavailableHint: string;
  defaultModel: string;
  defaultTag: string;
  detectCommand: string;
  detectType: "binary";
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
];
