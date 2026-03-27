import { useState, useCallback, useRef } from "react";
import { execFile } from "node:child_process";
import { Orchestrator } from "../orchestrator.js";
import { initProjectFolder } from "../config/loader.js";
import type { ConversationMessage, DisplayMessage } from "../types.js";

export type AgentState = "idle" | "thinking" | "error";

let systemIdCounter = 0;
function nextSystemId(): number {
  systemIdCounter -= 1;
  return systemIdCounter;
}

interface UseOrchestratorReturn {
  messages: DisplayMessage[];
  agentStates: Map<string, AgentState>;
  stickyTarget: string[] | undefined;
  dispatching: boolean;
  dispatch: (line: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
  clearMessages: () => void;
}

export function useOrchestrator(
  orchestrator: Orchestrator,
  maxAutoHops: number
): UseOrchestratorReturn {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [agentStates, setAgentStates] = useState<Map<string, AgentState>>(
    () => new Map(orchestrator.listAgents().map((a) => [a.name, "idle" as AgentState]))
  );
  const [stickyTarget, setStickyTarget] = useState<string[] | undefined>(undefined);
  const [dispatching, setDispatching] = useState(false);
  const projectFolderReady = useRef(false);
  const agentProviders = useRef(
    new Map(orchestrator.listAgents().map((a) => [a.name.toUpperCase(), a.provider]))
  );
  const agentTags = useRef(
    new Map(orchestrator.listAgents().map((a) => [a.name.toUpperCase(), a.tag]))
  );

  const dispatch = useCallback(async (line: string) => {
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

    const targets = explicitTargets ?? stickyTarget;

    if (!projectFolderReady.current) {
      await initProjectFolder(process.cwd());
      projectFolderReady.current = true;
    }

    const userMessage = orchestrator.addUserMessage(routing.raw);
    await orchestrator.appendTranscript(userMessage);

    const userDisplay: DisplayMessage = {
      ...userMessage,
      type: "user",
    };
    setMessages((prev) => [...prev, userDisplay]);

    setDispatching(true);

    try {
      await dispatchWithHandoffs(
        orchestrator,
        targets,
        maxAutoHops,
        agentProviders.current,
        agentTags.current,
        setMessages,
        setAgentStates
      );
    } finally {
      setDispatching(false);
    }
  }, [orchestrator, maxAutoHops, stickyTarget]);

  const addSystemMessage = useCallback((text: string) => {
    const msg: DisplayMessage = {
      id: nextSystemId(),
      from: "SYSTEM",
      text,
      createdAt: new Date().toISOString(),
      type: "system",
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  const clearMessages = useCallback(() => {
    orchestrator.clearConversation();
    setMessages([]);
  }, [orchestrator]);

  return { messages, agentStates, stickyTarget, dispatching, dispatch, addSystemMessage, clearMessages };
}

async function dispatchWithHandoffs(
  orchestrator: Orchestrator,
  initialTargets: string[] | undefined,
  maxHops: number,
  agentProviders: Map<string, string>,
  agentTags: Map<string, string>,
  setMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>,
  setAgentStates: React.Dispatch<React.SetStateAction<Map<string, AgentState>>>
): Promise<void> {
  let targets = initialTargets;
  let hops = 0;

  while (true) {
    const targetNames = targets ?? Array.from(
      orchestrator.listAgents().map((a) => a.name)
    );

    setAgentStates((prev) => {
      const next = new Map(prev);
      for (const name of targetNames) {
        next.set(name, "thinking");
      }
      return next;
    });

    const nameMap = new Map(
      orchestrator.listAgents().map((a) => [a.name.toUpperCase(), a.name])
    );

    const batch: ConversationMessage[] = [];
    await orchestrator.fanOutWithProgress(targets, (msg) => {
      batch.push(msg);
      const provider = agentProviders.get(msg.from) ?? "";
      const tag = agentTags.get(msg.from) ?? "";
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
        next.set(originalName, msg.text.startsWith("[Adapter Error]") ? "error" : "idle");
        return next;
      });
    });

    setAgentStates((prev) => {
      const next = new Map(prev);
      for (const name of targetNames) {
        if (next.get(name) === "thinking") {
          next.set(name, "idle");
        }
      }
      return next;
    });

    const nextSelectors = extractNextSelectors(batch);
    if (nextSelectors.length === 0) return;

    const humanTag = orchestrator.getHumanTag().toLowerCase();
    const humanName = orchestrator.getHumanName().toLowerCase();
    const agentSelectors = nextSelectors.filter((s) => {
      const n = s.toLowerCase();
      return n !== humanTag && n !== humanName;
    });
    if (agentSelectors.length === 0) return;

    const resolvedTargets = Array.from(
      new Set(agentSelectors.flatMap((s) => orchestrator.resolveTargets(s)))
    );
    if (resolvedTargets.length === 0) return;

    hops += 1;
    if (Number.isFinite(maxHops) && hops >= maxHops) {
      const systemMsg: DisplayMessage = {
        id: nextSystemId(),
        from: "SYSTEM",
        text: `Stopped auto-handoff after ${maxHops} hops.`,
        createdAt: new Date().toISOString(),
        type: "system",
      };
      setMessages((prev) => [...prev, systemMsg]);
      return;
    }

    const handoffMsg: DisplayMessage = {
      id: nextSystemId(),
      from: "SYSTEM",
      text: `Auto handoff via @next to ${resolvedTargets.join(", ")}`,
      createdAt: new Date().toISOString(),
      type: "system",
    };
    setMessages((prev) => [...prev, handoffMsg]);
    targets = resolvedTargets;
  }
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

function extractNextSelectors(messages: ConversationMessage[]): string[] {
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

function parseRouting(line: string): { mentions: string[]; raw: string } {
  const mentionRegex = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]+)\b/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = mentionRegex.exec(line)) !== null) {
    mentions.push(match[2].toLowerCase());
  }
  return { mentions, raw: line };
}
