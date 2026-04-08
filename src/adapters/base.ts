import { ConversationMessage, PersonaConfig, AgentEvent } from "../types.js";

export interface AgentAdapter {
  name: string;
  provider: string;
  model: string;
  humanName: string;
  init(config: PersonaConfig): Promise<void>;
  stream(messages: ConversationMessage[], signal?: AbortSignal): AsyncGenerator<AgentEvent>;
  destroy(): Promise<void>;
  getSdkSessionId(): string;
  setSdkSessionId(id: string): void;
}

export function formatTranscript(messages: ConversationMessage[], agentName: string, humanName: string): string {
  return messages
    .map((m) => {
      const role = m.from === agentName ? "you" : m.from === humanName ? "user" : "agent";
      return `${m.from} (${role}):: ${m.text}`;
    })
    .join("\n\n");
}

/** Shorten an absolute path to parent/basename for sidebar display */
export function extractShortPath(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return parts.slice(-2).join("/");
}

/** Truncate a string to maxLen, adding ellipsis */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}
