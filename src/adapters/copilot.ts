import { CopilotClient, CopilotSession, approveAll } from "@github/copilot-sdk";
import { AgentAdapter, formatTranscript } from "./base.js";
import { ConversationMessage, PersonaConfig, AgentEvent } from "../types.js";

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
  private copilotSessionId = "";

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

  async *stream(messages: ConversationMessage[], signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    if (!this.session) {
      yield { type: "error", message: "[Copilot session not initialized]" };
      return;
    }
    if (signal?.aborted) {
      yield { type: "error", message: "[Aborted] Copilot was cancelled" };
      return;
    }

    yield { type: "activity", activity: "thinking" };

    const transcript = formatTranscript(messages, this.name, this.humanName);

    // Bridge callback events to async generator via a queue
    const eventQueue: AgentEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const push = (event: AgentEvent) => {
      eventQueue.push(event);
      if (resolve) { resolve(); resolve = null; }
    };

    const waitForEvent = (): Promise<void> => {
      if (eventQueue.length > 0 || done) return Promise.resolve();
      return new Promise<void>((r) => { resolve = r; });
    };

    const timer = setTimeout(() => {
      push({ type: "error", message: `[Timeout] ${this.name} exceeded ${Math.floor(this.timeout / 1000)}s` });
      done = true;
    }, this.timeout);

    const unsubscribe = this.session.on((event: any) => {
      if (signal?.aborted) {
        push({ type: "error", message: `[Aborted] ${this.name} was cancelled` });
        done = true;
        return;
      }

      if (event.type === "tool.execution_start") {
        const toolName = String(event.data?.toolName ?? "").toLowerCase();
        if (toolName === "view" || toolName === "read" || toolName === "report_intent") {
          push({ type: "activity", activity: "reading", detail: event.data?.toolName });
        } else if (toolName === "create" || toolName === "edit" || toolName === "write") {
          push({ type: "activity", activity: "writing", detail: event.data?.toolName });
        } else if (toolName === "run" || toolName === "bash" || toolName === "shell") {
          push({ type: "activity", activity: "running", detail: event.data?.toolName });
        } else if (toolName === "search" || toolName === "grep" || toolName === "find") {
          push({ type: "activity", activity: "searching", detail: event.data?.toolName });
        } else {
          push({ type: "activity", activity: "thinking", detail: event.data?.toolName });
        }
      }

      if (event.type === "tool.execution_complete") {
        push({ type: "activity", activity: "thinking" });
      }

      if (event.type === "assistant.turn_start") {
        push({ type: "activity", activity: "thinking" });
      }

      if (event.type === "assistant.message") {
        const content = event.data?.content;
        if (typeof content === "string" && content.length > 0) {
          push({ type: "activity", activity: "idle" });
          push({ type: "response", text: content });
          done = true;
        }
      }

      if (event.type === "session.error") {
        push({ type: "error", message: event.data?.message ?? "Unknown Copilot error" });
        done = true;
      }
    });

    // Send the message (non-blocking)
    const sendSession = async () => {
      try {
        await this.session!.send({ prompt: transcript });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("Session not found")) {
          await this.createSession();
          try {
            await this.session!.send({ prompt: transcript });
          } catch (retryErr) {
            push({ type: "error", message: retryErr instanceof Error ? retryErr.message : String(retryErr) });
            done = true;
          }
        } else {
          push({ type: "error", message });
          done = true;
        }
      }
    };

    sendSession();

    // Drain the event queue as a generator
    try {
      while (!done || eventQueue.length > 0) {
        await waitForEvent();
        while (eventQueue.length > 0) {
          const event = eventQueue.shift()!;
          yield event;
          if (event.type === "response" || event.type === "error") {
            clearTimeout(timer);
            unsubscribe?.();
            return;
          }
        }
      }
    } finally {
      clearTimeout(timer);
      unsubscribe?.();
    }

    yield { type: "activity", activity: "idle" };
    yield { type: "response", text: `[No text response from ${this.name}]` };
  }

  async destroy(): Promise<void> {
    if (this.session) {
      try { await this.session.disconnect(); } catch (err) { console.error(`[${this.name}] disconnect:`, err); }
    }
    if (this.client) {
      try { await this.client.stop(); } catch (err) { console.error(`[${this.name}] stop:`, err); }
    }
  }

  getSdkSessionId(): string { return this.copilotSessionId; }
  setSdkSessionId(id: string): void {
    this.copilotSessionId = id;
    // Session ID is stored; createSession() will use it on next init() or stream()
  }

  private async createSession(): Promise<void> {
    if (this.session) {
      try { await this.session.disconnect(); } catch (err) { console.error(`[${this.name}] stale session disconnect:`, err); }
    }
    if (this.client) {
      try { await this.client.stop(); } catch (err) { console.error(`[${this.name}] stale client stop:`, err); }
    }

    process.env.NODE_NO_WARNINGS = "1";

    this.client = new CopilotClient({
      ...(this.cliPath ? { cliPath: this.cliPath } : {}),
    });

    await this.client.start();

    // Resume existing session or create new one
    if (this.copilotSessionId) {
      try {
        this.session = await (this.client as any).resumeSession(this.copilotSessionId, {
          model: this.model,
          systemMessage: { content: this.systemPrompt },
          onPermissionRequest: approveAll,
        });
        return;
      } catch (err) {
        console.error(`[${this.name}] resumeSession failed, creating new:`, err);
        this.copilotSessionId = "";
      }
    }

    const sessionId = `llm-party-${this.name}-${Date.now()}`;
    this.session = await this.client.createSession({
      sessionId,
      model: this.model,
      systemMessage: { content: this.systemPrompt },
      onPermissionRequest: approveAll,
    });
    this.copilotSessionId = sessionId;
  }
}
