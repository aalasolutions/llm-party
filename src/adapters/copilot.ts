import { CopilotClient, CopilotSession, approveAll } from "@github/copilot-sdk";
import { AgentAdapter } from "./base.js";
import { ConversationMessage, PersonaConfig } from "../types.js";

export class CopilotAdapter implements AgentAdapter {
  public name: string;
  public provider = "copilot";
  public model: string;

  private client?: CopilotClient;
  private session?: CopilotSession;

  constructor(name: string, model: string) {
    this.name = name;
    this.model = model;
  }

  async init(config: PersonaConfig): Promise<void> {
    const systemPrompt = config.resolvedPrompt ?? "";

    const cliPath = config.executablePath ?? process.env.COPILOT_CLI_EXECUTABLE;

    this.client = new CopilotClient({
      ...(cliPath ? { cliPath } : {}),
    });

    await this.client.start();

    this.session = await this.client.createSession({
      model: this.model,
      systemMessage: { content: systemPrompt },
      onPermissionRequest: approveAll,
    });
  }

  async send(messages: ConversationMessage[]): Promise<string> {
    if (!this.session) {
      return "[Copilot session not initialized]";
    }

    const transcript = messages
      .map((m) => `[${m.from}]: ${m.text}`)
      .join("\n\n");

    const response = await this.session.sendAndWait({ prompt: transcript });

    if (response && response.data && typeof response.data.content === "string" && response.data.content.length > 0) {
      return response.data.content;
    }

    return "[No text response from Copilot]";
  }

  async destroy(): Promise<void> {
    if (this.session) {
      await this.session.disconnect();
    }
    if (this.client) {
      await this.client.stop();
    }
  }
}
