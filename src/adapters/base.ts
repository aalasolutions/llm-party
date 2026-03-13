import { ConversationMessage, PersonaConfig } from "../types.js";

export interface AgentAdapter {
  name: string;
  provider: string;
  model: string;
  init(config: PersonaConfig): Promise<void>;
  send(messages: ConversationMessage[]): Promise<string>;
  destroy(): Promise<void>;
}
