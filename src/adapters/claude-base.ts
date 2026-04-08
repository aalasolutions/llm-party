import { query } from "@anthropic-ai/claude-agent-sdk";
import { AgentAdapter, formatTranscript, extractShortPath, truncate } from "./base.js";
import { ConversationMessage, PersonaConfig, AgentEvent } from "../types.js";

export abstract class ClaudeBaseAdapter implements AgentAdapter {
  public name: string;
  public abstract provider: string;
  public model: string;
  public humanName: string;

  protected systemPrompt = "";
  protected sessionId = "";
  protected runtimeEnv: NodeJS.ProcessEnv = {};
  protected claudeExecutable?: string;

  constructor(name: string, model: string, humanName: string) {
    this.name = name;
    this.model = model;
    this.humanName = humanName;
  }

  async init(config: PersonaConfig): Promise<void> {
    this.systemPrompt = config.resolvedPrompt ?? "";
    this.runtimeEnv = await this.buildEnv(config);
    this.claudeExecutable = config.executablePath ?? process.env.CLAUDE_CODE_EXECUTABLE;
  }

  protected async buildEnv(config: PersonaConfig): Promise<NodeJS.ProcessEnv> {
    const configEnv = config.env ?? {};
    const mapped: Record<string, string> = {};

    if (configEnv.AUTH_URL) {
      mapped.ANTHROPIC_BASE_URL = configEnv.AUTH_URL;
    }
    if (configEnv.AUTH_TOKEN) {
      mapped.ANTHROPIC_AUTH_TOKEN = configEnv.AUTH_TOKEN;
    }
    if (configEnv.AUTH_URL || configEnv.AUTH_TOKEN) {
      mapped.ANTHROPIC_DEFAULT_HAIKU_MODEL = this.model;
      mapped.ANTHROPIC_DEFAULT_SONNET_MODEL = this.model;
      mapped.ANTHROPIC_DEFAULT_OPUS_MODEL = this.model;
    }

    return { ...process.env, ...mapped, ...configEnv };
  }

  async *stream(messages: ConversationMessage[], signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const transcript = formatTranscript(messages, this.name, this.humanName);
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

    yield { type: "activity", activity: "thinking" };

    try {
      for await (const message of query({ prompt: transcript, options })) {
        if (signal?.aborted) {
          yield { type: "error", message: `[Aborted] ${this.name} was cancelled` };
          return;
        }

        if (!message || typeof message !== "object") continue;

        // Capture session ID from init message
        if (
          "type" in message &&
          "subtype" in message &&
          "session_id" in message &&
          message.type === "system" &&
          message.subtype === "init" &&
          typeof message.session_id === "string"
        ) {
          this.sessionId = message.session_id;
        }

        // Extract tool activity from assistant messages with tool_use content blocks
        if ("type" in message && message.type === "assistant" && "message" in message) {
          const msg = message.message as any;
          const blocks = msg?.content;
          if (Array.isArray(blocks)) {
            for (const block of blocks) {
              if (block.type === "tool_use" && block.name) {
                const toolName = String(block.name).toLowerCase();
                const input = block.input as Record<string, any> | undefined;
                const shortPath = extractShortPath(input?.file_path ?? input?.path ?? input?.pattern);
                if (toolName === "read" || toolName === "glob") {
                  yield { type: "activity", activity: "reading", detail: shortPath ? `Read: ${shortPath}` : block.name };
                } else if (toolName === "write" || toolName === "edit") {
                  yield { type: "activity", activity: "writing", detail: shortPath ? `Edit: ${shortPath}` : block.name };
                } else if (toolName === "bash") {
                  const cmd = typeof input?.command === "string" ? truncate(input.command, 40) : "shell";
                  yield { type: "activity", activity: "running", detail: `Bash: ${cmd}` };
                } else if (toolName === "grep" || toolName === "search" || toolName === "websearch") {
                  const query = typeof input?.pattern === "string" ? truncate(input.pattern, 30) : block.name;
                  yield { type: "activity", activity: "searching", detail: `Search: ${query}` };
                } else {
                  yield { type: "activity", activity: "thinking", detail: block.name };
                }
              } else if (block.type === "thinking") {
                yield { type: "activity", activity: "thinking" };
              }
            }
          }
        }

        // Tool results coming back means agent is processing, back to thinking
        if ("type" in message && message.type === "user") {
          yield { type: "activity", activity: "thinking" };
        }

        // Final result
        if ("result" in message) {
          const result = message.result;
          const text = typeof result === "string" && result.length > 0
            ? result
            : `[No text response from ${this.name}]`;
          yield { type: "activity", activity: "idle" };
          yield { type: "response", text };
          return;
        }
      }
    } catch (err) {
      console.log(`[${this.name}] SDK error:`, err);
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
      return;
    }

    yield { type: "activity", activity: "idle" };
    yield { type: "response", text: `[No text response from ${this.name}]` };
  }

  async destroy(): Promise<void> {
    return;
  }

  getSdkSessionId(): string {
    return this.sessionId;
  }

  setSdkSessionId(id: string): void {
    this.sessionId = id;
  }
}
