import { createSignal, Show } from "solid-js";
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
import { COLORS } from "./theme.js";
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
  maxAutoHops: number;
  config: AppConfig;
}

export function App(props: AppProps) {
  const renderer = useRenderer();
  const { messages, agentStates, stickyTarget, dispatching, dispatch, addSystemMessage, clearMessages } =
    useOrchestrator(props.orchestrator, props.maxAutoHops);
  const humanName = props.orchestrator.getHumanName();
  const agents = props.orchestrator.listAgents();
  let scrollRef: ScrollBoxRenderable | null = null;
  const [screen, setScreen] = createSignal<"chat" | "config">("chat");
  const [showAgents, setShowAgents] = createSignal(false);
  const [showInfo, setShowInfo] = createSignal(false);

  // Signal handlers for clean exit
  process.on("SIGINT", () => renderer.destroy());
  process.on("SIGTERM", () => renderer.destroy());
  process.on("SIGHUP", () => renderer.destroy());
  process.on("SIGTSTP", () => {
    process.once("SIGCONT", () => renderer.resume());
    renderer.suspend();
  });

  const gracefulExit = () => {
    renderer.destroy();
    const adapters = props.orchestrator.getAdapters();
    Promise.allSettled(adapters.map((a) => a.destroy()));
  };

  useKeyboard((key) => {
    // Ctrl+P: toggle agents panel
    if (key.ctrl && key.name === "p") {
      setShowAgents((v) => !v);
      return;
    }

    if (showAgents()) return;

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
          existingConfig={props.config}
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
      />

      {/* Input */}
      <InputLine
        humanName={humanName}
        onSubmit={handleSubmit}
        disabled={dispatching() || showAgents() || showInfo()}
        disabledMessage={showAgents() ? "" : undefined}
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
    </box>
    </Show>
  );
}
