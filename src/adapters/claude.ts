import { query } from "@anthropic-ai/claude-agent-sdk";
import { AgentAdapter } from "./base.js";
import { ConversationMessage, PersonaConfig } from "../types.js";

export class ClaudeAdapter implements AgentAdapter {
  public name: string;
  public provider = "claude";
  public model: string;

  private systemPrompt = "";
  private sessionId = "";
  private runtimeEnv: NodeJS.ProcessEnv = {};
  private claudeExecutable?: string;

  constructor(name: string, model: string) {
    this.name = name;
    this.model = model;
  }

  async init(config: PersonaConfig): Promise<void> {
    this.systemPrompt = Array.isArray(config.systemPrompt) ? config.systemPrompt.join("\n\n") : config.systemPrompt;
    this.runtimeEnv = { ...process.env, ...(config.env ?? {}) };
    this.claudeExecutable = config.executablePath ?? process.env.CLAUDE_CODE_EXECUTABLE;
  }

  async send(messages: ConversationMessage[]): Promise<string> {
    const transcript = messages
      .map((m) => `[${m.from}]: ${m.text}`)
      .join("\n\n");

    return await this.queryClaude(transcript);
  }

  async destroy(): Promise<void> {
    return;
  }
  private async queryClaude(transcript: string): Promise<string> {
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
          : "[No text response from Claude]";
      }
    }

    return "[No text response from Claude]";
  }
}
