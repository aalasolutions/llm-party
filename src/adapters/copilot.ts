import { CopilotClient, CopilotSession, approveAll } from "@github/copilot-sdk";
import { AgentAdapter, formatTranscript } from "./base.js";
import { ConversationMessage, PersonaConfig } from "../types.js";

export class CopilotAdapter implements AgentAdapter {
  public name: string;
  public provider = "copilot";
  public model: string;
  public humanName: string;

  private client?: CopilotClient;
  private session?: CopilotSession;
  private systemPrompt = "";
  private cliPath?: string;
  private timeout = 600000;

  constructor(name: string, model: string, humanName: string) {
    this.name = name;
    this.model = model;
    this.humanName = humanName;
  }

  async init(config: PersonaConfig): Promise<void> {
    this.systemPrompt = config.resolvedPrompt ?? "";
    this.cliPath = config.executablePath ?? process.env.COPILOT_CLI_EXECUTABLE;
    if (config.timeout && config.timeout > 0) {
      this.timeout = config.timeout * 1000;
    }
    await this.createSession();
  }

  async send(messages: ConversationMessage[], signal?: AbortSignal): Promise<string> {
    if (!this.session) {
      return "[Copilot session not initialized]";
    }
    if (signal?.aborted) {
      return "[Aborted] Copilot was cancelled";
    }

    const transcript = formatTranscript(messages, this.name, this.humanName);
    try {
      return await this.sendToSession(transcript);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Session not found")) {
        await this.createSession();
        return await this.sendToSession(transcript);
      }
      throw err;
    }
  }

  async destroy(): Promise<void> {
    if (this.session) {
      await this.session.disconnect();
    }
    if (this.client) {
      await this.client.stop();
    }
  }

  private async createSession(): Promise<void> {
    if (this.session) {
      try { await this.session.disconnect(); } catch { /* stale session */ }
    }
    if (this.client) {
      try { await this.client.stop(); } catch { /* stale client */ }
    }

    process.env.NODE_NO_WARNINGS = "1";

    this.client = new CopilotClient({
      ...(this.cliPath ? { cliPath: this.cliPath } : {}),
    });

    await this.client.start();

    this.session = await this.client.createSession({
      model: this.model,
      systemMessage: { content: this.systemPrompt },
      onPermissionRequest: approveAll,
    });
  }

  private async sendToSession(transcript: string): Promise<string> {
    if (!this.session) {
      return "[Copilot session not initialized]";
    }

    const response = await this.session.sendAndWait({ prompt: transcript }, this.timeout);

    if (response && response.data && typeof response.data.content === "string" && response.data.content.length > 0) {
      return response.data.content;
    }

    return "[No text response from Copilot]";
  }
}
