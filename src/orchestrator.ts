import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { AgentAdapter } from "./adapters/base.js";
import { ConversationMessage, AgentActivity, QueuedMessage } from "./types.js";
import { toTag } from "./utils.js";

export interface OrchestratorOptions {
  contextWindowSize?: number;
  reminderInterval?: number;
  maxAutoHops?: number;
  queueTtlMs?: number;
  maxQueueSize?: number;
}

const DEFAULT_REMINDERS = [
  "Internal operations are invisible. Never narrate boot, memory writes, or protocol compliance.",
  "Have you written to project memory since your last significant action? If not, do it now.",
  "Mind-map entry needed? If you learned something non-obvious this session, write it to mind-map now.",
  "Check: did your last response end with @next:<tag>? Every response needs one.",
  "Long-running task? Launch it in the background and return to the conversation. Do not block.",
  "Log is append-only. Never overwrite, summarize, or delete past entries.",
  "Before marking anything done: verify it the way another agent would. Not 'I think I did it.'",
  "Self-memory check: did you receive a correction this session? Write it to your agent file now.",
  "Global awareness: if this work affects other projects, write a one-liner to projects.yml history.",
];

const QUEUE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_QUEUE_SIZE = 20;

// ─── Agent Queue Manager ───────────────────────────────────────

interface AgentQueue {
  processing: boolean;
  pending: QueuedMessage[];
  controller?: AbortController;
}

class AgentQueueManager {
  private queues: Map<string, AgentQueue> = new Map();

  register(agentName: string): void {
    this.queues.set(agentName, { processing: false, pending: [] });
  }

  enqueue(agentName: string, message: QueuedMessage, maxSize = MAX_QUEUE_SIZE): boolean {
    const queue = this.queues.get(agentName);
    if (!queue) return false;
    if (queue.pending.length >= maxSize) {
      queue.pending.shift(); // drop oldest
    }
    queue.pending.push(message);
    return true;
  }

  drain(agentName: string, ttlMs = QUEUE_TTL_MS): QueuedMessage[] {
    const queue = this.queues.get(agentName);
    if (!queue) return [];
    const now = Date.now();
    const valid = queue.pending.filter((m) => now - new Date(m.queuedAt).getTime() < ttlMs);
    queue.pending = [];
    return valid;
  }

  isProcessing(agentName: string): boolean {
    return this.queues.get(agentName)?.processing ?? false;
  }

  setProcessing(agentName: string, value: boolean): void {
    const queue = this.queues.get(agentName);
    if (queue) queue.processing = value;
  }

  hasPending(agentName: string): boolean {
    return (this.queues.get(agentName)?.pending.length ?? 0) > 0;
  }

  pendingCount(agentName: string): number {
    return this.queues.get(agentName)?.pending.length ?? 0;
  }

  get anyProcessing(): boolean {
    for (const q of this.queues.values()) {
      if (q.processing) return true;
    }
    return false;
  }

  setController(agentName: string, controller: AbortController): void {
    const queue = this.queues.get(agentName);
    if (queue) queue.controller = controller;
  }

  private cancelled: Set<string> = new Set();

  abortAgent(agentName: string): void {
    const queue = this.queues.get(agentName);
    if (!queue) return;
    this.cancelled.add(agentName);
    queue.controller?.abort();
    queue.pending = [];
    queue.processing = false;
  }

  wasCancelled(agentName: string): boolean {
    return this.cancelled.has(agentName);
  }

  clearCancelled(agentName: string): void {
    this.cancelled.delete(agentName);
  }

  abortAll(): void {
    for (const q of this.queues.values()) {
      q.controller?.abort();
      q.pending = [];
    }
  }

  clearAll(): void {
    for (const q of this.queues.values()) {
      q.pending = [];
      q.processing = false;
    }
  }
}

// ─── Orchestrator ──────────────────────────────────────────────

export type OnMessageCallback = (message: ConversationMessage) => void;
export type OnActivityCallback = (agentName: string, activity: AgentActivity, detail?: string) => void;
export type OnSystemCallback = (text: string) => void;

export class Orchestrator {
  private readonly agents: Map<string, AgentAdapter>;
  private readonly agentTags: Map<string, string>;
  private readonly conversation: ConversationMessage[] = [];
  private readonly lastSeenByAgent: Map<string, number> = new Map();
  private readonly humanName: string;
  private readonly humanTag: string;
  private sessionId: string;
  private transcriptPath: string;
  private readonly defaultTimeout: number;
  private readonly agentTimeouts: Map<string, number>;
  // TODO: use contextWindowSize for per-agent message truncation.
  // Opus has 1M tokens, Sonnet 200K, Copilot 200K, GLM 200K.
  // Long conversations will need truncation based on each agent's context limit.
  private readonly contextWindowSize: number;
  private readonly reminderInterval: number;
  private readonly reminderCursors: Map<string, number> = new Map();
  private readonly maxAutoHops: number;
  private readonly queueTtlMs: number;
  private readonly maxQueueSize: number;
  private messageId = 0;
  private stickyTargets: string[] | undefined;

  private readonly queueManager = new AgentQueueManager();
  private manifestSavePromise: Promise<void> = Promise.resolve();

  // Callbacks set by the UI layer
  private onMessage: OnMessageCallback = () => {};
  private onActivity: OnActivityCallback = () => {};
  private onSystem: OnSystemCallback = () => {};

  constructor(
    agents: AgentAdapter[],
    humanName = "USER",
    agentTags?: Record<string, string>,
    humanTag?: string,
    defaultTimeout = 600000,
    agentTimeouts?: Record<string, number>,
    options?: OrchestratorOptions
  ) {
    this.agents = new Map(agents.map((agent) => [agent.name, agent]));
    this.agentTags = new Map(
      agents.map((agent) => [agent.name, agentTags?.[agent.name] ?? toTag(agent.name)])
    );
    this.humanName = humanName;
    this.humanTag = humanTag ?? toTag(humanName);
    this.defaultTimeout = defaultTimeout;
    this.agentTimeouts = new Map(Object.entries(agentTimeouts ?? {}));
    this.contextWindowSize = options?.contextWindowSize ?? 16;
    this.reminderInterval = options?.reminderInterval ?? 8;
    this.maxAutoHops = options?.maxAutoHops ?? 15;
    this.queueTtlMs = options?.queueTtlMs ?? QUEUE_TTL_MS;
    this.maxQueueSize = options?.maxQueueSize ?? MAX_QUEUE_SIZE;
    this.sessionId = createSessionId();
    this.transcriptPath = path.resolve(".llm-party", "sessions", `transcript-${this.sessionId}.jsonl`);
    for (const agent of agents) {
      this.lastSeenByAgent.set(agent.name, 0);
      this.queueManager.register(agent.name);
    }
  }

  // ─── Callbacks ─────────────────────────────────────────────

  setCallbacks(onMessage: OnMessageCallback, onActivity: OnActivityCallback, onSystem: OnSystemCallback): void {
    this.onMessage = onMessage;
    this.onActivity = onActivity;
    this.onSystem = onSystem;
  }

  // ─── Getters ───────────────────────────────────────────────

  getSessionId(): string { return this.sessionId; }
  getTranscriptPath(): string { return this.transcriptPath; }
  getHumanName(): string { return this.humanName; }
  getHumanTag(): string { return this.humanTag; }

  get dispatching(): boolean { return this.queueManager.anyProcessing; }

  getStickyTarget(): string[] | undefined { return this.stickyTargets; }
  setStickyTarget(targets: string[] | undefined): void { this.stickyTargets = targets; }

  getQueueStatus(): Array<{ name: string; processing: boolean; pending: number }> {
    return this.listAgents().map((a) => ({
      name: a.name,
      processing: this.queueManager.isProcessing(a.name),
      pending: this.queueManager.pendingCount(a.name),
    }));
  }

  clearConversation(): void {
    this.conversation.length = 0;
    this.messageId = 0;
    for (const agent of this.agents.keys()) {
      this.lastSeenByAgent.set(agent, 0);
    }
    this.queueManager.clearAll();
    this.sessionId = createSessionId();
    this.transcriptPath = path.resolve(".llm-party", "sessions", `transcript-${this.sessionId}.jsonl`);
  }

  getAdapters(): AgentAdapter[] { return Array.from(this.agents.values()); }

  listAgents(): Array<{ name: string; tag: string; provider: string; model: string }> {
    return Array.from(this.agents.values()).map((agent) => ({
      name: agent.name,
      tag: this.agentTags.get(agent.name) ?? toTag(agent.name),
      provider: agent.provider,
      model: agent.model
    }));
  }

  // ─── Message Handling ──────────────────────────────────────

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

  getHistory(): ConversationMessage[] { return [...this.conversation]; }

  resolveTargets(selector: string): string[] {
    const normalized = selector.trim().toLowerCase();
    if (normalized === "all" || normalized === "everyone") {
      return Array.from(this.agents.keys());
    }

    const byName = Array.from(this.agents.values())
      .filter((agent) => {
        const tag = this.agentTags.get(agent.name) ?? toTag(agent.name);
        return agent.name.toLowerCase() === normalized || tag.toLowerCase() === normalized;
      })
      .map((agent) => agent.name);
    if (byName.length > 0) return byName;

    return Array.from(this.agents.values())
      .filter((agent) => agent.provider.toLowerCase() === normalized)
      .map((agent) => agent.name);
  }

  // ─── Non-Blocking Dispatch ─────────────────────────────────

  dispatchToTargets(targetAgentNames: string[], chainHops = 0): void {
    for (const name of targetAgentNames) {
      const agent = this.agents.get(name);
      if (!agent) continue;

      if (this.queueManager.isProcessing(name)) {
        // Agent busy: queue the message. The latest user message is already in conversation.
        // We queue a marker so the agent knows to check for new unseen messages when it finishes.
        this.queueManager.enqueue(name, {
          from: "dispatch",
          text: "",
          queuedAt: new Date().toISOString(),
          chainHops,
        }, this.maxQueueSize);
        // Don't change activity state - agent is already active (thinking/reading/etc)
        // Just notify about the queue event so the UI updates the count
        this.onSystem(`Queued for ${name} (busy, ${this.queueManager.pendingCount(name)} pending)`);
      } else {
        // Agent idle: start processing immediately
        this.processAgent(name, chainHops);
      }
    }
  }

  private async processAgent(agentName: string, chainHops: number): Promise<void> {
    const agent = this.agents.get(agentName);
    if (!agent) return;

    this.queueManager.clearCancelled(agentName);
    this.queueManager.setProcessing(agentName, true);
    this.onActivity(agentName, "thinking");

    const historyMaxId = this.messageId;
    const lastSeen = this.lastSeenByAgent.get(agentName) ?? 0;

    // Filter messages the agent hasn't seen yet (excludes its own messages).
    // lastSeenByAgent is restored from manifest on resume, so each agent
    // gets exactly the messages it missed, whether from a fresh start or
    // a resumed session where other agents continued without it.
    const unseen = this.conversation.filter(
      (msg) => msg.id > lastSeen && msg.from.toUpperCase() !== agentName.toUpperCase()
    );

    if (unseen.length === 0) {
      this.lastSeenByAgent.set(agentName, historyMaxId);
      this.queueManager.setProcessing(agentName, false);
      this.onActivity(agentName, "idle");
      this.drainQueue(agentName);
      return;
    }

    const inputMessages = this.buildInputForAgent(agentName, unseen);
    const responseText = await this.streamWithTimeout(agentName, agent, inputMessages, this.timeoutFor(agentName));

    // Agent was cancelled while streaming: suppress response, don't pollute conversation
    if (this.queueManager.wasCancelled(agentName)) {
      this.lastSeenByAgent.set(agentName, historyMaxId);
      this.queueManager.setProcessing(agentName, false);
      this.onActivity(agentName, "idle");
      return;
    }

    const response: ConversationMessage = {
      id: ++this.messageId,
      from: agentName.toUpperCase(),
      text: responseText,
      createdAt: new Date().toISOString()
    };
    this.lastSeenByAgent.set(agentName, historyMaxId);
    this.conversation.push(response);
    await this.appendTranscript(response);
    this.onMessage(response);

    // Save manifest AFTER response is created and cursor updated
    await this.saveManifest();

    this.queueManager.setProcessing(agentName, false);

    // Process @next handoffs
    const isError = responseText.startsWith("[Timeout]") || responseText.startsWith("[Error]") || responseText.startsWith("[Adapter Error]");
    if (!isError) {
      this.processHandoffs(response, chainHops);
    }

    // Drain own queue
    this.drainQueue(agentName);
  }

  private processHandoffs(response: ConversationMessage, currentHops: number): void {
    const selectors = extractNextSelectors([response]);
    if (selectors.length === 0) return;

    const humanTag = this.humanTag.toLowerCase();
    const humanName = this.humanName.toLowerCase();
    const agentSelectors = selectors.filter((s) => {
      const n = s.toLowerCase();
      return n !== humanTag && n !== humanName;
    });
    if (agentSelectors.length === 0) return;

    const resolvedTargets = Array.from(
      new Set(agentSelectors.flatMap((s) => this.resolveTargets(s)))
    );
    if (resolvedTargets.length === 0) return;

    const nextHops = currentHops + 1;
    if (nextHops >= this.maxAutoHops) {
      this.onSystem(`Stopped auto-handoff after ${this.maxAutoHops} hops.`);
      return;
    }

    this.onSystem(`Auto handoff via @next to ${resolvedTargets.join(", ")}`);
    this.dispatchToTargets(resolvedTargets, nextHops);
  }

  private drainQueue(agentName: string): void {
    if (!this.queueManager.hasPending(agentName)) {
      this.onActivity(agentName, "idle");
      return;
    }

    const pending = this.queueManager.drain(agentName, this.queueTtlMs);
    if (pending.length === 0) {
      this.onActivity(agentName, "idle");
      return;
    }

    // Take the max chainHops from the queued messages
    const maxHops = Math.max(...pending.map((m) => m.chainHops));
    if (maxHops >= this.maxAutoHops) {
      this.onSystem(`Stopped auto-handoff for ${agentName} after ${this.maxAutoHops} hops.`);
      this.onActivity(agentName, "idle");
      return;
    }

    // Process again with merged context (unseen messages will include everything new)
    this.processAgent(agentName, maxHops);
  }

  private async streamWithTimeout(
    agentName: string,
    agent: AgentAdapter,
    messages: ConversationMessage[],
    timeoutMs: number,
  ): Promise<string> {
    const controller = new AbortController();
    this.queueManager.setController(agentName, controller);
    let timer: NodeJS.Timeout | undefined;
    let resolved = false;

    return new Promise<string>((resolve) => {
      timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          controller.abort();
          this.onActivity(agentName, "error", "timeout");
          resolve(`[Timeout] ${agentName} exceeded ${Math.floor(timeoutMs / 1000)}s`);
        }
      }, timeoutMs);

      (async () => {
        try {
          for await (const event of agent.stream(messages, controller.signal)) {
            if (resolved) return;

            if (event.type === "activity") {
              this.onActivity(agentName, event.activity, event.detail);
            } else if (event.type === "response") {
              resolved = true;
              if (timer) clearTimeout(timer);
              resolve(event.text);
              return;
            } else if (event.type === "error") {
              resolved = true;
              if (timer) clearTimeout(timer);
              this.onActivity(agentName, "error");
              resolve(`[Error] ${agentName}: ${event.message}`);
              return;
            }
          }

          if (!resolved) {
            resolved = true;
            if (timer) clearTimeout(timer);
            resolve(`[No text response from ${agentName}]`);
          }
        } catch (err) {
          if (!resolved) {
            resolved = true;
            if (timer) clearTimeout(timer);
            this.onActivity(agentName, "error");
            resolve(`[Error] ${agentName}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      })();
    });
  }

  // ─── Transcript ────────────────────────────────────────────

  async appendTranscript(message: ConversationMessage): Promise<void> {
    try {
      const transcriptDir = path.dirname(this.transcriptPath);
      await mkdir(transcriptDir, { recursive: true });
      await appendFile(this.transcriptPath, `${JSON.stringify(message)}\n`, "utf8");
    } catch {
      // Transcript write failure should not crash the session
    }
  }

  async saveHistory(targetPath: string): Promise<void> {
    await writeFile(targetPath, JSON.stringify(this.conversation, null, 2), "utf8");
  }

  async loadTranscript(sessionId: string): Promise<ConversationMessage[]> {
    const transcriptFile = path.resolve(".llm-party", "sessions", `transcript-${sessionId}.jsonl`);
    const content = await readFile(transcriptFile, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const messages: ConversationMessage[] = lines.map((line) => JSON.parse(line));

    this.conversation.length = 0;
    this.conversation.push(...messages);

    const maxId = messages.length > 0 ? Math.max(...messages.map((m) => m.id)) : 0;
    this.messageId = maxId;

    for (const agent of this.agents.keys()) {
      this.lastSeenByAgent.set(agent, maxId);
    }

    this.sessionId = sessionId;
    this.transcriptPath = transcriptFile;

    await this.loadManifest();

    return messages;
  }

  hasMessages(): boolean { return this.conversation.length > 0; }

  // ─── Session Manifest ───────────────────────────────────────

  private manifestPath(): string {
    const dir = path.dirname(this.transcriptPath);
    const base = path.basename(this.transcriptPath, ".jsonl");
    return path.join(dir, `${base}.manifest.json`);
  }

  private async saveManifest(): Promise<void> {
    this.manifestSavePromise = this.manifestSavePromise.then(async () => {
      try {
        const agents: Record<string, { provider: string; sdkSessionId: string; lastSeenId: number }> = {};
        for (const [name, adapter] of this.agents) {
          const sid = adapter.getSdkSessionId();
          agents[name] = {
            provider: adapter.provider,
            sdkSessionId: sid || "",
            lastSeenId: this.lastSeenByAgent.get(name) ?? 0,
          };
        }
        const manifest = {
          orchestratorSessionId: this.sessionId,
          messageId: this.messageId,
          stickyTarget: this.stickyTargets,
          agents,
        };
        await writeFile(this.manifestPath(), JSON.stringify(manifest, null, 2), "utf8");
      } catch (err) {
        console.error("[manifest] write failed:", err);
      }
    });
    return this.manifestSavePromise;
  }

  private async loadManifest(): Promise<void> {
    try {
      const content = await readFile(this.manifestPath(), "utf8");
      const manifest = JSON.parse(content);
      if (Array.isArray(manifest.stickyTarget)) {
        this.stickyTargets = manifest.stickyTarget;
      }
      const agentMap = manifest.agents ?? {};
      for (const [name, data] of Object.entries(agentMap)) {
        const adapter = this.agents.get(name);
        const agentData = data as { sdkSessionId?: string; lastSeenId?: number };
        if (!adapter || !agentData) continue;
        if (typeof agentData.sdkSessionId === "string" && agentData.sdkSessionId) {
          adapter.setSdkSessionId(agentData.sdkSessionId);
        }
        if (typeof agentData.lastSeenId === "number") {
          this.lastSeenByAgent.set(name, agentData.lastSeenId);
        }
      }
    } catch (err) {
      console.error("[manifest] load failed (agents start fresh):", err);
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────

  cancelAgents(names: string[]): void {
    for (const name of names) {
      this.queueManager.abortAgent(name);
      this.onActivity(name, "idle");
    }
  }

  async abortAll(): Promise<void> {
    this.queueManager.abortAll();
    await this.saveManifest();
  }

  // ─── Internals ─────────────────────────────────────────────

  private timeoutFor(agentName: string): number {
    return this.agentTimeouts.get(agentName) ?? this.defaultTimeout;
  }

  private buildInputForAgent(agentName: string, unseen: ConversationMessage[]): ConversationMessage[] {
    const filtered = unseen.filter((msg) => msg.from.toUpperCase() !== agentName.toUpperCase());

    if (this.reminderInterval <= 0 || filtered.length < this.reminderInterval) {
      return filtered;
    }

    const result: ConversationMessage[] = [];
    let reminderIndex = this.reminderCursors.get(agentName) ?? 0;
    for (let i = 0; i < filtered.length; i++) {
      result.push(filtered[i]);
      if ((i + 1) % this.reminderInterval === 0 && i < filtered.length - 1) {
        const reminder = DEFAULT_REMINDERS[reminderIndex % DEFAULT_REMINDERS.length];
        console.log(`[reminder] injected after msg ${i + 1} for ${agentName}: ${reminder}`);
        result.push({
          id: -1,
          from: "SYSTEM",
          text: `<SYSTEM_REMINDER>${reminder}</SYSTEM_REMINDER>`,
          createdAt: new Date().toISOString(),
        });
        reminderIndex++;
      }
    }
    this.reminderCursors.set(agentName, reminderIndex);
    return result;
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function createSessionId(): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const rand = randomBytes(4).toString("hex");
  return `${timestamp}-${process.pid}-${rand}`;
}

export function extractNextSelectors(messages: ConversationMessage[]): string[] {
  const selectors: string[] = [];
  for (const msg of messages) {
    const regex = /@next\s*:\s*([A-Za-z0-9_-]+)/gi;
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(msg.text)) !== null) {
      selectors.push(match[1]);
    }
    const controlMatch = msg.text.match(/@control[\s\S]*?next\s*:\s*([A-Za-z0-9_-]+)[\s\S]*?@end/i);
    if (controlMatch?.[1]) {
      selectors.push(controlMatch[1]);
    }
  }
  return selectors;
}
