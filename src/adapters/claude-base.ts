import { query } from "@anthropic-ai/claude-agent-sdk";
import { AgentAdapter, formatTranscript } from "./base.js";
import { ConversationMessage, PersonaConfig } from "../types.js";

export abstract class ClaudeBaseAdapter implements AgentAdapter {
  public name: string;
  public abstract provider: string;
  public model: string;

  protected systemPrompt = "";
  protected sessionId = "";
  protected runtimeEnv: NodeJS.ProcessEnv = {};
  protected claudeExecutable?: string;

  constructor(name: string, model: string) {
    this.name = name;
    this.model = model;
  }

  async init(config: PersonaConfig): Promise<void> {
    this.systemPrompt = config.resolvedPrompt ?? "";
    this.runtimeEnv = await this.buildEnv(config);
    this.claudeExecutable = config.executablePath ?? process.env.CLAUDE_CODE_EXECUTABLE;
  }

  protected async buildEnv(config: PersonaConfig): Promise<NodeJS.ProcessEnv> {
    return { ...process.env, ...(config.env ?? {}) };
  }

  async send(messages: ConversationMessage[]): Promise<string> {
    return await this.querySDK(formatTranscript(messages));
  }

  async destroy(): Promise<void> {
    return;
  }

  protected async querySDK(transcript: string): Promise<string> {
    const executableOpt = this.claudeExecutable
      ? { pathToClaudeCodeExecutable: this.claudeExecutable }
      : {};

    const options = {
      cwd: process.cwd(),
      env: this.runtimeEnv,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      permissionMode: "bypassPermissions" as const,
      allowDangerouslySkipPermissions: true,
      systemPrompt: this.systemPrompt,
      model: this.model,
      settingSources: [],
      ...(this.sessionId ? { resume: this.sessionId } : {}),
      ...executableOpt
    };

    for await (const message of query({ prompt: transcript, options })) {
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        "subtype" in message &&
        "session_id" in message &&
        message.type === "system" &&
        message.subtype === "init" &&
        typeof message.session_id === "string"
      ) {
        this.sessionId = message.session_id;
      }

      if (message && typeof message === "object" && "result" in message) {
        const result = message.result;
        return typeof result === "string" && result.length > 0
          ? result
          : `[No text response from ${this.name}]`;
      }
    }

    return `[No text response from ${this.name}]`;
  }
}
