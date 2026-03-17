import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentAdapter } from "./adapters/base.js";
import { ConversationMessage } from "./types.js";

export class Orchestrator {
  private readonly agents: Map<string, AgentAdapter>;
  private readonly agentTags: Map<string, string>;
  private readonly conversation: ConversationMessage[] = [];
  private readonly lastSeenByAgent: Map<string, number> = new Map();
  private readonly humanName: string;
  private readonly humanTag: string;
  private readonly sessionId: string;
  private readonly transcriptPath: string;
  private messageId = 0;
  private readonly contextWindowSize = 16;

  constructor(
    agents: AgentAdapter[],
    humanName = "USER",
    agentTags?: Record<string, string>,
    humanTag?: string
  ) {
    this.agents = new Map(agents.map((agent) => [agent.name, agent]));
    this.agentTags = new Map(
      agents.map((agent) => [agent.name, agentTags?.[agent.name] ?? defaultTagFor(agent.name)])
    );
    this.humanName = humanName;
    this.humanTag = humanTag ?? defaultTagFor(humanName);
    this.sessionId = createSessionId();
    this.transcriptPath = path.resolve("data", "sessions", `transcript-${this.sessionId}.jsonl`);
    for (const agent of agents) {
      this.lastSeenByAgent.set(agent.name, 0);
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getTranscriptPath(): string {
    return this.transcriptPath;
  }

  getHumanName(): string {
    return this.humanName;
  }

  getHumanTag(): string {
    return this.humanTag;
  }

  listAgents(): Array<{ name: string; tag: string; provider: string; model: string }> {
    return Array.from(this.agents.values()).map((agent) => ({
      name: agent.name,
      tag: this.agentTags.get(agent.name) ?? defaultTagFor(agent.name),
      provider: agent.provider,
      model: agent.model
    }));
  }

  addUserMessage(text: string): ConversationMessage {
    const message: ConversationMessage = {
      id: ++this.messageId,
      from: this.humanName,
      text,
      createdAt: new Date().toISOString()
    };
    this.conversation.push(message);
    return message;
  }

  getHistory(): ConversationMessage[] {
    return [...this.conversation];
  }

  resolveTargets(selector: string): string[] {
    const normalized = selector.trim().toLowerCase();
    if (normalized === "all" || normalized === "everyone") {
      return Array.from(this.agents.keys());
    }

    const byName = Array.from(this.agents.values())
      .filter((agent) => {
        const tag = this.agentTags.get(agent.name) ?? defaultTagFor(agent.name);
        return agent.name.toLowerCase() === normalized || tag.toLowerCase() === normalized;
      })
      .map((agent) => agent.name);
    if (byName.length > 0) {
      return byName;
    }

    return Array.from(this.agents.values())
      .filter((agent) => agent.provider.toLowerCase() === normalized)
      .map((agent) => agent.name);
  }

  async fanOut(targetAgentNames?: string[]): Promise<ConversationMessage[]> {
    return this.fanOutWithProgress(targetAgentNames, () => {});
  }

  async fanOutWithProgress(
    targetAgentNames: string[] | undefined,
    onMessage: (message: ConversationMessage) => void
  ): Promise<ConversationMessage[]> {
    const requestedTargets = targetAgentNames && targetAgentNames.length > 0
      ? targetAgentNames
      : Array.from(this.agents.keys());
    const targets = requestedTargets
      .map((name) => this.agents.get(name))
      .filter((agent): agent is AgentAdapter => Boolean(agent));

    const historyMaxId = this.messageId;

    const settled = await Promise.allSettled(
      targets.map(async (agent) => {
        const lastSeen = this.lastSeenByAgent.get(agent.name) ?? 0;
        const unseen = this.conversation.filter(
          (msg) => msg.id > lastSeen && msg.from.toUpperCase() !== agent.name.toUpperCase()
        );

        if (unseen.length === 0) {
          this.lastSeenByAgent.set(agent.name, historyMaxId);
          const response: ConversationMessage = {
            id: ++this.messageId,
            from: agent.name.toUpperCase(),
            text: "[No new messages for this agent]",
            createdAt: new Date().toISOString()
          };
          this.conversation.push(response);
          await this.appendTranscript(response);
          onMessage(response);
          return response;
        }

        const inputMessages = this.buildInputForAgent(agent.name, unseen);
        const responseText = await this.sendWithTimeout(agent, inputMessages, this.timeoutFor(agent.provider));
        const response: ConversationMessage = {
          id: ++this.messageId,
          from: agent.name.toUpperCase(),
          text: responseText,
          createdAt: new Date().toISOString()
        };
        this.lastSeenByAgent.set(agent.name, historyMaxId);
        this.conversation.push(response);
        await this.appendTranscript(response);
        onMessage(response);
        return response;
      })
    );

    const results: ConversationMessage[] = settled.map((item, idx) => {
      if (item.status === "fulfilled") {
        return item.value;
      }

      const agent = targets[idx];
      const response: ConversationMessage = {
        id: ++this.messageId,
        from: agent.name.toUpperCase(),
        text: `[Adapter Error] ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`,
        createdAt: new Date().toISOString()
      };
      this.lastSeenByAgent.set(agent.name, historyMaxId);
      this.conversation.push(response);
      void this.appendTranscript(response);
      onMessage(response);
      return response;
    });

    return results;
  }

  async appendTranscript(message: ConversationMessage): Promise<void> {
    const transcriptDir = path.dirname(this.transcriptPath);
    await mkdir(transcriptDir, { recursive: true });
    await appendFile(this.transcriptPath, `${JSON.stringify(message)}\n`, "utf8");
  }

  async saveHistory(targetPath: string): Promise<void> {
    await writeFile(targetPath, JSON.stringify(this.conversation, null, 2), "utf8");
  }

  private async sendWithTimeout(
    agent: AgentAdapter,
    messages: ConversationMessage[],
    timeoutMs: number
  ): Promise<string> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<string>((resolve) => {
      timer = setTimeout(() => {
        resolve(`[Timeout] ${agent.name} exceeded ${Math.floor(timeoutMs / 1000)}s`);
      }, timeoutMs);
    });

    try {
      return await Promise.race([agent.send(messages), timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private timeoutFor(provider: string): number {
    if (provider.toLowerCase() === "glm") {
      return 240000;
    }

    return 120000;
  }

  private buildInputForAgent(agentName: string, unseen: ConversationMessage[]): ConversationMessage[] {
    const recent = this.conversation.slice(-this.contextWindowSize);
    const merged = [...recent, ...unseen];
    const dedupById = new Map<number, ConversationMessage>();

    for (const msg of merged) {
      dedupById.set(msg.id, msg);
    }

    const ordered = Array.from(dedupById.values()).sort((a, b) => a.id - b.id);
    return ordered.filter((msg) => msg.from.toUpperCase() !== agentName.toUpperCase());
  }
}

function createSessionId(): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return `${timestamp}-${process.pid}`;
}

function defaultTagFor(name: string): string {
  const compact = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return compact || "agent";
}
