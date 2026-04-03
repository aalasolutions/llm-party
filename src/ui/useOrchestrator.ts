import { createSignal } from "solid-js";
import { execFile } from "node:child_process";
import { Orchestrator } from "../orchestrator.js";
import { initProjectFolder } from "../config/loader.js";
import type { ConversationMessage, DisplayMessage, AgentActivity } from "../types.js";

export type AgentState = AgentActivity;

let systemIdCounter = 0;
function nextSystemId(): number {
  systemIdCounter -= 1;
  return systemIdCounter;
}

interface UseOrchestratorReturn {
  messages: () => DisplayMessage[];
  agentStates: () => Map<string, AgentState>;
  queueCounts: () => Map<string, number>;
  stickyTarget: () => string[] | undefined;
  dispatching: () => boolean;
  dispatch: (line: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
  addDisplayMessage: (msg: DisplayMessage) => void;
  clearMessages: () => void;
}

export function useOrchestrator(
  orchestrator: Orchestrator,
): UseOrchestratorReturn {
  const [messages, setMessages] = createSignal<DisplayMessage[]>([]);
  const [agentStates, setAgentStates] = createSignal<Map<string, AgentState>>(
    new Map(orchestrator.listAgents().map((a) => [a.name, "idle" as AgentState]))
  );
  const [stickyTarget, setStickyTarget] = createSignal<string[] | undefined>(undefined);
  const [dispatching, setDispatching] = createSignal(false);
  const [queueCounts, setQueueCounts] = createSignal<Map<string, number>>(
    new Map(orchestrator.listAgents().map((a) => [a.name, 0]))
  );
  let projectFolderReady = false;
  const agentProviders = new Map(orchestrator.listAgents().map((a) => [a.name.toUpperCase(), a.provider]));
  const agentTagsMap = new Map(orchestrator.listAgents().map((a) => [a.name.toUpperCase(), a.tag]));
  const nameMap = new Map(orchestrator.listAgents().map((a) => [a.name.toUpperCase(), a.name]));

  const updateQueueCounts = () => {
    const status = orchestrator.getQueueStatus();
    setQueueCounts(new Map(status.map((s) => [s.name, s.pending])));
  };

  // Wire orchestrator callbacks
  orchestrator.setCallbacks(
    // onMessage: agent response arrived
    (msg: ConversationMessage) => {
      const provider = agentProviders.get(msg.from) ?? "";
      const tag = agentTagsMap.get(msg.from) ?? "";
      const display: DisplayMessage = {
        ...msg,
        type: "agent",
        provider,
        tag,
      };
      setMessages((prev) => [...prev, display]);

      const originalName = nameMap.get(msg.from) ?? msg.from;
      setAgentStates((prev) => {
        const next = new Map(prev);
        const isErr = msg.text.startsWith("[Adapter Error]") || msg.text.startsWith("[Error]") || msg.text.startsWith("[Timeout]");
        next.set(originalName, isErr ? "error" : "idle");
        return next;
      });

      setDispatching(orchestrator.dispatching);
      updateQueueCounts();
    },
    // onActivity: agent state changed
    (agentName: string, activity: AgentActivity) => {
      const originalName = nameMap.get(agentName.toUpperCase()) ?? agentName;
      setAgentStates((prev) => {
        const next = new Map(prev);
        next.set(originalName, activity);
        return next;
      });
      setDispatching(orchestrator.dispatching);
      updateQueueCounts();
    },
    // onSystem: system message
    (text: string) => {
      addSystemMessage(text);
      updateQueueCounts();
    }
  );

  const dispatch = async (line: string) => {
    if (!line.trim()) return;

    const routing = parseRouting(line);
    const resolvedAgents: string[] = [];

    for (const mention of routing.mentions) {
      const resolved = orchestrator.resolveTargets(mention);
      resolvedAgents.push(...resolved);
    }

    const explicitTargets = resolvedAgents.length > 0
      ? Array.from(new Set(resolvedAgents))
      : undefined;

    if (explicitTargets && explicitTargets.length > 0) {
      setStickyTarget(explicitTargets);
    }

    const targets = explicitTargets ?? stickyTarget() ?? Array.from(
      orchestrator.listAgents().map((a) => a.name)
    );

    if (!projectFolderReady) {
      await initProjectFolder(process.cwd());
      projectFolderReady = true;
    }

    const userMessage = orchestrator.addUserMessage(routing.raw);
    await orchestrator.appendTranscript(userMessage);

    const userDisplay: DisplayMessage = {
      ...userMessage,
      type: "user",
    };
    setMessages((prev) => [...prev, userDisplay]);

    setDispatching(true);

    // Fire-and-forget: dispatch to targets, don't await
    orchestrator.dispatchToTargets(targets);
  };

  const addSystemMessage = (text: string) => {
    const msg: DisplayMessage = {
      id: nextSystemId(),
      from: "SYSTEM",
      text,
      createdAt: new Date().toISOString(),
      type: "system",
    };
    setMessages((prev) => [...prev, msg]);
  };

  const addDisplayMessage = (msg: DisplayMessage) => {
    setMessages((prev) => [...prev, msg]);
  };

  const clearMessages = () => {
    orchestrator.clearConversation();
    setMessages([]);
  };

  return { messages, agentStates, queueCounts, stickyTarget, dispatching, dispatch, addSystemMessage, addDisplayMessage, clearMessages };
}

export function getChangedFiles(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile("git", ["status", "--porcelain"], { cwd: process.cwd() }, (error, stdout) => {
      if (error) { resolve([]); return; }
      const files = stdout.split("\n").filter((l) => l.length >= 4).map((l) => l.slice(3));
      resolve(Array.from(new Set(files)));
    });
  });
}

function parseRouting(line: string): { mentions: string[]; raw: string } {
  const mentionRegex = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]+)\b/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = mentionRegex.exec(line)) !== null) {
    mentions.push(match[2].toLowerCase());
  }
  return { mentions, raw: line };
}
