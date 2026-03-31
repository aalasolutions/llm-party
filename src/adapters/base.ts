import { ConversationMessage, PersonaConfig } from "../types.js";

export interface AgentAdapter {
  name: string;
  provider: string;
  model: string;
  humanName: string;
  init(config: PersonaConfig): Promise<void>;
  send(messages: ConversationMessage[], signal?: AbortSignal): Promise<string>;
  destroy(): Promise<void>;
}

export function formatTranscript(messages: ConversationMessage[], agentName: string, humanName: string): string {
  return messages
    .map((m) => {
      const role = m.from === agentName ? "you" : m.from === humanName ? "user" : "agent";
      return `${m.from} (${role}):: ${m.text}`;
    })
    .join("\n\n");
}
