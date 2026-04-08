import { createSignal, onMount, Show, For } from "solid-js";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { ScrollBoxRenderable } from "@opentui/core";
import { spawn } from "node:child_process";
import { Orchestrator } from "../orchestrator.js";
import { useOrchestrator, getChangedFiles } from "./useOrchestrator.js";
import { MessageBubble } from "./MessageBubble.js";
import { StatusBar } from "./StatusBar.js";
import { AgentSidebar } from "./AgentSidebar.js";
import { InputLine } from "./InputLine.js";
import { ConfigWizard } from "./ConfigWizard.js";
import { AgentsPanel } from "./AgentsPanel.js";
import { InfoPanel } from "./InfoPanel.js";
import { CancelPanel } from "./CancelPanel.js";
import { SplashScreen } from "./SplashScreen.js";
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
  const { messages, agentStates, agentDetails, agentActivityLog, queueCounts, stickyTarget, dispatching, dispatch, addSystemMessage, addDisplayMessage, clearMessages, refreshStickyTarget } =
    useOrchestrator(props.orchestrator);
  const humanName = props.orchestrator.getHumanName();
  const agents = props.orchestrator.listAgents();
  let scrollRef: ScrollBoxRenderable | null = null;
  const [screen, setScreen] = createSignal<"chat" | "config">("chat");
  const [freshConfig, setFreshConfig] = createSignal<AppConfig>(props.config);
  const [showAgents, setShowAgents] = createSignal(false);
  const [showInfo, setShowInfo] = createSignal(false);
  const [showCancel, setShowCancel] = createSignal(false);

  const dims = useTerminalDimensions();
  const [sidebarEnabled, setSidebarEnabled] = createSignal(true);

  const cwd = () => {
    const full = process.cwd();
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return home && full.startsWith(home) ? "~" + full.slice(home.length) : full;
  };

  const MIN_WIDTH_FOR_SIDEBAR = 100;
  const sidebarWidth = () => {
    const w = dims().width;
    return Math.max(24, Math.min(40, Math.floor(w * 0.32)));
  };
  const sidebarVisible = () => sidebarEnabled() && dims().width >= MIN_WIDTH_FOR_SIDEBAR;
  const leftPaneWidth = () => {
    const w = dims().width;
    return sidebarVisible() ? Math.max(0, w - (sidebarWidth() + 1)) : w;
  };

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

    // Ctrl+B: toggle sidebar (when screen is wide enough)
    if (key.ctrl && key.name === "b") {
      setSidebarEnabled((v) => !v);
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
      <box flexDirection="row" width="100%" flexGrow={1} flexBasis={0} alignItems="stretch">
        <box flexDirection="column" flexGrow={1} flexBasis={0} flexShrink={1}>
          {/* Chat area: flexBasis=0 prevents content from pushing siblings off screen */}
          <scrollbox
            ref={(el: ScrollBoxRenderable) => scrollRef = el}
            stickyScroll={true}
            stickyStart="bottom"
            flexGrow={1}
            flexBasis={0}
            flexShrink={1}
          >
            <Show when={messages().length === 0}>
              <SplashScreen />
            </Show>
            <For each={messages()}>{(msg) => (
              <MessageBubble message={msg} humanName={humanName} />
            )}</For>
          </scrollbox>

          {/* Status bar */}
          <StatusBar
            agents={agents}
            agentStates={agentStates()}
            stickyTarget={stickyTarget()}
            queueCounts={queueCounts()}
            sidebarVisible={sidebarVisible()}
          />

          {/* Input */}
          <InputLine
            humanName={humanName}
            onSubmit={handleSubmit}
            disabled={showAgents() || showInfo() || showCancel()}
            disabledMessage={showAgents() || showCancel() ? "" : showInfo() ? "info panel opened" : undefined}
            // keep a small safety margin so the separator never wraps when the right sidebar is visible
            availableWidth={sidebarVisible() ? Math.max(0, leftPaneWidth() - 2) : undefined}
          />
        </box>

        <Show when={sidebarVisible()}>
          <box paddingLeft={1} paddingY={0} flexDirection="column" height="100%">
            <AgentSidebar
              agents={agents}
              agentStates={agentStates()}
              agentDetails={agentDetails()}
              agentActivityLog={agentActivityLog()}
              queueCounts={queueCounts()}
              width={sidebarWidth()}
            />
          </box>
        </Show>
      </box>

      {/* Bottom bar: CWD */}
      <box flexShrink={0} paddingX={1}>
        <text fg={COLORS.textDim}>{cwd()}</text>
      </box>

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
