import { ConversationMessage, PersonaConfig } from "../types.js";

export interface AgentAdapter {
  name: string;
  provider: string;
  model: string;
  init(config: PersonaConfig): Promise<void>;
  send(messages: ConversationMessage[]): Promise<string>;
  destroy(): Promise<void>;
}

export function formatTranscript(messages: ConversationMessage[]): string {
  return messages
    .map((m) => `[${m.from}]: ${m.text}`)
    .join("\n\n");
}
