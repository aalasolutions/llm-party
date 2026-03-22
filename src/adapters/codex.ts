import { Codex } from "@openai/codex-sdk";
import { AgentAdapter, formatTranscript } from "./base.js";
import { ConversationMessage, PersonaConfig } from "../types.js";

export class CodexAdapter implements AgentAdapter {
  public name: string;
  public provider = "codex";
  public model: string;

  private codex?: Codex;
  private thread?: ReturnType<Codex["startThread"]>;

  constructor(name: string, model: string) {
    this.name = name;
    this.model = model;
  }

  async init(config: PersonaConfig): Promise<void> {
    const cliPath = config.executablePath ?? process.env.CODEX_CLI_EXECUTABLE;
    const systemPrompt = config.resolvedPrompt ?? "";

    this.codex = new Codex({
      ...(cliPath ? { codexPathOverride: cliPath } : {}),
      ...(config.env?.OPENAI_API_KEY ? { apiKey: config.env.OPENAI_API_KEY } : {}),
      ...(systemPrompt ? { config: { developer_instructions: systemPrompt } } : {}),
    });

    this.thread = this.codex.startThread({
      model: this.model,
      sandboxMode: "danger-full-access",
      workingDirectory: process.cwd(),
      approvalPolicy: "never",
    });
  }

  async send(messages: ConversationMessage[]): Promise<string> {
    if (!this.thread) {
      return "[Codex thread not initialized]";
    }

    const turn = await this.thread.run(formatTranscript(messages));

    if (turn.finalResponse && turn.finalResponse.length > 0) {
      return turn.finalResponse;
    }

    return "[No text response from Codex]";
  }

  async destroy(): Promise<void> {
    this.thread = undefined;
    this.codex = undefined;
  }
}
