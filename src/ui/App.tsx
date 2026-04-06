import { createSignal, onMount, Show } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import type { ScrollBoxRenderable } from "@opentui/core";
import { spawn } from "node:child_process";
import { Orchestrator } from "../orchestrator.js";
import { useOrchestrator, getChangedFiles } from "./useOrchestrator.js";
import { MessageBubble } from "./MessageBubble.js";
import { StatusBar } from "./StatusBar.js";
import { InputLine } from "./InputLine.js";
import { ConfigWizard } from "./ConfigWizard.js";
import { AgentsPanel } from "./AgentsPanel.js";
import { InfoPanel } from "./InfoPanel.js";
import { CancelPanel } from "./CancelPanel.js";
import { COLORS } from "./theme.js";
import { loadConfig } from "../config/loader.js";
import type { AppConfig } from "../types.js";

function copyToClipboard(text: string): void {
  const proc = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
  proc.stdin?.write(text);
  proc.stdin?.end();
}

function copySelection(renderer: CliRenderer): boolean {
  const selection = (renderer as any).getSelection?.();
  if (!selection) return false;
  const text = selection.getSelectedText?.();
  if (!text) return false;
  copyToClipboard(text);
  (renderer as any).clearSelection?.();
  return true;
}

interface AppProps {
  orchestrator: Orchestrator;
  config: AppConfig;
  configPath: string;
  resumeSessionId?: string;
}

export function App(props: AppProps) {
  const renderer = useRenderer();
  const { messages, agentStates, queueCounts, stickyTarget, dispatching, dispatch, addSystemMessage, addDisplayMessage, clearMessages, refreshStickyTarget } =
    useOrchestrator(props.orchestrator);
  const humanName = props.orchestrator.getHumanName();
  const agents = props.orchestrator.listAgents();
  let scrollRef: ScrollBoxRenderable | null = null;
  const [screen, setScreen] = createSignal<"chat" | "config">("chat");
  const [freshConfig, setFreshConfig] = createSignal<AppConfig>(props.config);
  const [showAgents, setShowAgents] = createSignal(false);
  const [showInfo, setShowInfo] = createSignal(false);
  const [showCancel, setShowCancel] = createSignal(false);

  // Resume session from --resume CLI flag or /resume command
  const resumeSession = async (sessionId: string) => {
    try {
      const restored = await props.orchestrator.loadTranscript(sessionId);
      const displayMsgs: import("../types.js").DisplayMessage[] = restored.map((msg) => {
        const isHuman = msg.from.toUpperCase() === humanName.toUpperCase();
        const agentInfo = agents.find((a) => a.name.toUpperCase() === msg.from.toUpperCase());
        return {
          ...msg,
          type: isHuman ? "user" as const : "agent" as const,
          provider: agentInfo?.provider ?? "",
          tag: agentInfo?.tag ?? "",
        };
      });
      for (const msg of displayMsgs) {
        addDisplayMessage(msg);
      }
      refreshStickyTarget();
      addSystemMessage(`Resumed session ${sessionId} (${restored.length} messages)`);
    } catch (err) {
      addSystemMessage(`Failed to resume: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  onMount(() => {
    if (props.resumeSessionId) {
      resumeSession(props.resumeSessionId);
    }
  });

  // Signal handlers for clean exit
  process.on("SIGINT", () => gracefulExit());
  process.on("SIGTERM", () => gracefulExit());
  process.on("SIGHUP", () => gracefulExit());
  process.on("SIGTSTP", () => {
    process.once("SIGCONT", () => renderer.resume());
    renderer.suspend();
  });

  const gracefulExit = async () => {
    await props.orchestrator.abortAll();
    renderer.destroy();
    const adapters = props.orchestrator.getAdapters();
    Promise.allSettled(adapters.map((a) => a.destroy())).finally(() => {
      process.exit(0);
    });
    // Force exit after 2s if adapters don't clean up
    setTimeout(() => process.exit(0), 2000);
  };

  useKeyboard((key) => {
    // Ctrl+P: toggle agents panel
    if (key.ctrl && key.name === "p") {
      setShowAgents((v) => !v);
      return;
    }

    if (showAgents() || showCancel() || showInfo()) return;

    // Esc: open cancel panel if any agents are active
    if (key.name === "escape") {
      const active = agents.filter((a) => {
        const state = agentStates().get(a.name);
        return state && state !== "idle" && state !== "error";
      }).map((a) => a.name);
      if (active.length > 0) {
        setShowCancel(true);
      }
      return;
    }

    // Ctrl+C: copy selection if any, otherwise exit
    if (key.ctrl && key.name === "c") {
      if (!copySelection(renderer)) {
        gracefulExit();
      }
      return;
    }
    if (key.ctrl && key.name === "l") {
      clearMessages();
      return;
    }
    if (key.name === "f12") {
      (renderer as any).console?.toggle?.();
      return;
    }
    if (key.name === "pageup") {
      scrollRef?.scrollBy(-10);
      return;
    }
    if (key.name === "pagedown") {
      scrollRef?.scrollBy(10);
      return;
    }
  });

  const handleSubmit = async (line: string) => {
    if (line === "/exit") {
      gracefulExit();
      return;
    }

    if (line === "/agents") {
      setShowAgents(true);
      return;
    }

    if (line === "/session") {
      addSystemMessage(
        `Session: ${props.orchestrator.getSessionId()}\nTranscript: ${props.orchestrator.getTranscriptPath()}`
      );
      return;
    }

    if (line.startsWith("/save ")) {
      const filePath = line.replace("/save ", "").trim();
      if (!filePath) { addSystemMessage("Usage: /save <path>"); return; }
      await props.orchestrator.saveHistory(filePath);
      addSystemMessage(`Saved history to ${filePath}`);
      return;
    }

    if (line === "/clear") {
      clearMessages();
      return;
    }

    if (line === "/config") {
      try {
        const reloaded = await loadConfig(props.configPath);
        setFreshConfig(reloaded);
      } catch {
        // Fall back to boot-time config if read fails
      }
      setScreen("config");
      return;
    }

    if (line === "/changes") {
      const files = await getChangedFiles();
      addSystemMessage(
        files.length > 0
          ? `Modified files:\n${files.map((f) => `  ${f}`).join("\n")}`
          : "No modified files."
      );
      return;
    }

    if (line === "/info") {
      setShowInfo(true);
      return;
    }

    if (line.startsWith("/resume")) {
      const sid = line.replace("/resume", "").trim();
      if (!sid) { addSystemMessage("Usage: /resume <sessionId>"); return; }
      if (props.orchestrator.hasMessages()) {
        addSystemMessage("Resume only works before the first message.");
        return;
      }
      await resumeSession(sid);
      return;
    }

    // /flood - generate messages for scroll testing
    if (line.startsWith("/flood")) {
      const args = line.split(/\s+/);
      const count = parseInt(args[1], 10) || 50;
      const linesPerMsg = parseInt(args[2], 10) || 5;
      for (let i = 0; i < count; i++) {
        const lines = [];
        for (let j = 0; j < linesPerMsg; j++) {
          lines.push(`Line ${j + 1} of message ${i + 1}: ${"█".repeat(Math.floor(Math.random() * 60) + 20)}`);
        }
        addSystemMessage(`[FLOOD ${i + 1}/${count}]\n${lines.join("\n")}`);
      }
      return;
    }

    await dispatch(line);
  };

  const tagsLine = agents.map((a) => `@${a.tag}`).join(", ");

  return (
    <Show
      when={screen() !== "config"}
      fallback={
        <ConfigWizard
          isFirstRun={false}
          existingConfig={freshConfig()}
          onComplete={() => {
            addSystemMessage("Config saved. Restart llm-party to apply changes.");
            setScreen("chat");
          }}
          onCancel={() => setScreen("chat")}
        />
      }
    >
    <box flexDirection="column" width="100%" height="100%" onMouseUp={() => copySelection(renderer)}>
      {/* Chat area: flexBasis=0 prevents content from pushing siblings off screen */}
      <scrollbox
        ref={(el: ScrollBoxRenderable) => scrollRef = el}
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
        flexBasis={0}
        flexShrink={1}
      >
        {/* Header scrolls with messages */}
        <text fg={COLORS.primary} selectable>
          llm-party | {tagsLine} | /agents /config /session /save /changes /clear /exit
        </text>
        {messages().map((msg) => (
          <MessageBubble message={msg} humanName={humanName} />
        ))}
      </scrollbox>

      {/* Status bar */}
      <StatusBar
        agents={agents}
        agentStates={agentStates()}
        stickyTarget={stickyTarget()}
        queueCounts={queueCounts()}
      />

      {/* Input */}
      <InputLine
        humanName={humanName}
        onSubmit={handleSubmit}
        disabled={showAgents() || showInfo() || showCancel()}
        disabledMessage={showAgents() || showCancel() ? "" : undefined}
      />

      {/* Agents overlay */}
      {showAgents() && (
        <AgentsPanel
          agents={agents}
          onClose={() => setShowAgents(false)}
          onConfig={() => {
            setShowAgents(false);
            setScreen("config");
          }}
        />
      )}
      {showInfo() && (
        <InfoPanel
          sessionId={props.orchestrator.getSessionId()}
          onClose={() => setShowInfo(false)}
        />
      )}
      {showCancel() && (
        <CancelPanel
          activeAgents={agents.filter((a) => {
            const state = agentStates().get(a.name);
            return state && state !== "idle" && state !== "error";
          }).map((a) => a.name)}
          onCancel={(names) => {
            props.orchestrator.cancelAgents(names);
            const label = names.length === agents.length ? "all agents" : names.join(", ");
            addSystemMessage(`Cancelled ${label}`);
            setShowCancel(false);
          }}
          onClose={() => setShowCancel(false)}
        />
      )}
    </box>
    </Show>
  );
}
