import React, { useCallback, useEffect, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable, CliRenderer } from "@opentui/core";
import { spawn } from "node:child_process";
import { Orchestrator } from "../orchestrator.js";
import { useOrchestrator } from "./useOrchestrator.js";
import { MessageBubble } from "./MessageBubble.js";
import { StatusBar } from "./StatusBar.js";
import { InputLine } from "./InputLine.js";

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
  renderer: CliRenderer;
}

export function App({ orchestrator, maxAutoHops, renderer }: AppProps) {
  const { messages, agentStates, stickyTarget, dispatching, dispatch, addSystemMessage, clearMessages } =
    useOrchestrator(orchestrator, maxAutoHops);
  const humanName = orchestrator.getHumanName();
  const agents = orchestrator.listAgents();
  const [lastKey, setLastKey] = useState("");
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const sb = scrollRef.current;
    if (sb && !sb.isDestroyed) {
      sb.scrollTo(sb.scrollHeight);
    }
  }, [messages]);

  const gracefulExit = useCallback(() => {
    renderer.destroy();
    const adapters = orchestrator.getAdapters();
    Promise.allSettled(adapters.map((a) => a.destroy()));
  }, [orchestrator, renderer]);

  useKeyboard((key) => {
    // const hex = [...key.sequence].map((c: string) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
    // setLastKey(`name=${key.name} ctrl=${key.ctrl} meta=${key.meta} opt=${key.option} shift=${key.shift} seq=[${hex}]`);
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
    if (key.name === "pageup") {
      scrollRef.current?.scrollBy(-10);
      return;
    }
    if (key.name === "pagedown") {
      scrollRef.current?.scrollBy(10);
      return;
    }
  });

  const handleSubmit = useCallback(async (line: string) => {
    if (line === "/exit") {
      gracefulExit();
      return;
    }

    if (line === "/agents") {
      addSystemMessage(
        orchestrator.listAgents().map((a) =>
          `${a.name} tag=@${a.tag} provider=${a.provider} model=${a.model}`
        ).join("\n")
      );
      return;
    }

    if (line === "/history") {
      const history = orchestrator.getHistory();
      addSystemMessage(
        history.length > 0
          ? history.map((msg) => `${msg.createdAt} [${msg.from}] ${msg.text}`).join("\n")
          : "No history yet."
      );
      return;
    }

    if (line === "/session") {
      addSystemMessage(
        `Session: ${orchestrator.getSessionId()}\nTranscript: ${orchestrator.getTranscriptPath()}`
      );
      return;
    }

    if (line.startsWith("/save ")) {
      const filePath = line.replace("/save ", "").trim();
      if (!filePath) { addSystemMessage("Usage: /save <path>"); return; }
      await orchestrator.saveHistory(filePath);
      addSystemMessage(`Saved history to ${filePath}`);
      return;
    }

    if (line === "/clear") {
      clearMessages();
      return;
    }

    if (line === "/changes") {
      const { execFile } = await import("node:child_process");
      const files = await new Promise<string[]>((resolve) => {
        execFile("git", ["status", "--porcelain"], { cwd: process.cwd() }, (err, stdout) => {
          if (err) { resolve([]); return; }
          resolve(stdout.split("\n").filter((l) => l.length >= 4).map((l) => l.slice(3)));
        });
      });
      addSystemMessage(
        files.length > 0
          ? `Modified files:\n${files.map((f) => `  ${f}`).join("\n")}`
          : "No modified files."
      );
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
  }, [orchestrator, dispatch, addSystemMessage, clearMessages, gracefulExit]);

  const tagsLine = agents.map((a) => `@${a.tag}`).join(", ");

  return (
    <box flexDirection="column" width="100%" height="100%" onMouseUp={() => copySelection(renderer)}>
      {/* Chat area: flexBasis=0 prevents content from pushing siblings off screen */}
      <scrollbox
        ref={scrollRef}
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
        flexBasis={0}
        flexShrink={1}
      >
        {/* Header scrolls with messages */}
        <text fg="#00BFFF" selectable>
          llm-party | {tagsLine} | /agents /history /session /save /changes /flood /clear /exit
        </text>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} humanName={humanName} />
        ))}
      </scrollbox>

      {/* Status bar */}
      <StatusBar
        agents={agents}
        agentStates={agentStates}
        sessionId={orchestrator.getSessionId()}
        stickyTarget={stickyTarget}
      />

      {/* Input */}
      <InputLine
        humanName={humanName}
        onSubmit={handleSubmit}
        disabled={dispatching}
      />
    </box>
  );
}
