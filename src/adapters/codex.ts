import { Codex, type ThreadOptions } from "@openai/codex-sdk";
import { AgentAdapter, formatTranscript, extractShortPath, truncate } from "./base.js";
import { ConversationMessage, PersonaConfig, AgentEvent } from "../types.js";

export class CodexAdapter implements AgentAdapter {
  public name: string;
  public provider = "codex";
  public model: string;
  public humanName: string;

  private codex?: Codex;
  private thread?: ReturnType<Codex["startThread"]>;
  private threadId = "";
  private threadOptions: ThreadOptions = {};

  constructor(name: string, model: string, humanName: string) {
    this.name = name;
    this.model = model;
    this.humanName = humanName;
  }

  async init(config: PersonaConfig): Promise<void> {
    const cliPath = config.executablePath ?? process.env.CODEX_CLI_EXECUTABLE;
    const systemPrompt = config.resolvedPrompt ?? "";

    this.codex = new Codex({
      ...(cliPath ? { codexPathOverride: cliPath } : {}),
      ...(config.env?.OPENAI_API_KEY ? { apiKey: config.env.OPENAI_API_KEY } : {}),
      ...(systemPrompt ? { config: { developer_instructions: systemPrompt } } : {}),
    });

    this.threadOptions = {
      model: this.model,
      sandboxMode: "danger-full-access",
      workingDirectory: process.cwd(),
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    };

    if (this.threadId) {
      try {
        this.thread = this.codex.resumeThread(this.threadId, this.threadOptions);
        return;
      } catch (err) {
        console.error(`[${this.name}] resumeThread failed, starting fresh:`, err);
        this.threadId = "";
      }
    }

    this.thread = this.codex.startThread(this.threadOptions);
    this.threadId = this.thread.id ?? "";
  }

  async *stream(messages: ConversationMessage[], signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    if (!this.thread) {
      yield { type: "error", message: "[Codex thread not initialized]" };
      return;
    }
    if (signal?.aborted) {
      yield { type: "error", message: "[Aborted] Codex was cancelled" };
      return;
    }

    yield { type: "activity", activity: "thinking" };

    try {
      const result = await this.thread.runStreamed(formatTranscript(messages, this.name, this.humanName));
      let lastAgentMessage = "";

      for await (const event of result.events) {
        if (signal?.aborted) {
          yield { type: "error", message: "[Aborted] Codex was cancelled" };
          return;
        }

        if (event.type === "item.started" || event.type === "item.updated") {
          const item = event.item as any;
          if (item.type === "command_execution") {
            const cmd = typeof item.command === "string" ? truncate(item.command, 40) : "shell";
            yield { type: "activity", activity: "running", detail: `Bash: ${cmd}` };
          } else if (item.type === "file_change") {
            const filePath = extractShortPath(item.filename ?? item.path);
            yield { type: "activity", activity: "writing", detail: filePath ? `Edit: ${filePath}` : "file changes" };
          } else if (item.type === "reasoning") {
            yield { type: "activity", activity: "thinking", detail: "reasoning" };
          } else if (item.type === "web_search") {
            const q = typeof item.query === "string" ? truncate(item.query, 30) : "web";
            yield { type: "activity", activity: "searching", detail: `Search: ${q}` };
          } else if (item.type === "mcp_tool_call") {
            yield { type: "activity", activity: "running", detail: `${item.server}:${item.tool}` };
          }
        }

        if (event.type === "item.completed") {
          const item = event.item as any;
          if (item.type === "agent_message" && typeof item.text === "string") {
            lastAgentMessage = item.text;
          }
        }
      }

      const text = lastAgentMessage.length > 0
        ? lastAgentMessage
        : `[No text response from ${this.name}]`;

      // Capture thread ID after first run (id getter is populated after first turn)
      if (!this.threadId && this.thread?.id) {
        this.threadId = this.thread.id;
      }

      yield { type: "activity", activity: "idle" };
      yield { type: "response", text };
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async destroy(): Promise<void> {
    this.thread = undefined;
    this.codex = undefined;
  }

  getSdkSessionId(): string { return this.threadId; }
  setSdkSessionId(id: string): void {
    this.threadId = id;
    // Thread ID is stored; init() will use it on next call via resumeThread
  }
}
