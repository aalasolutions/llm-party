import React, { useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { CliRenderer } from "@opentui/core";
import { Orchestrator } from "../orchestrator.js";
import { useOrchestrator } from "./useOrchestrator.js";
import { MessageBubble } from "./MessageBubble.js";
import { StatusBar } from "./StatusBar.js";
import { InputLine } from "./InputLine.js";

interface AppProps {
  orchestrator: Orchestrator;
  maxAutoHops: number;
  renderer: CliRenderer;
}

export function App({ orchestrator, maxAutoHops, renderer }: AppProps) {
  const { messages, agentStates, stickyTarget, dispatching, dispatch, addSystemMessage } =
    useOrchestrator(orchestrator, maxAutoHops);
  const humanName = orchestrator.getHumanName();
  const agents = orchestrator.listAgents();

  const gracefulExit = useCallback(() => {
    const adapters = orchestrator.getAdapters();
    Promise.allSettled(adapters.map((a) => a.destroy())).then(() => renderer.destroy());
  }, [orchestrator, renderer]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      gracefulExit();
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

    await dispatch(line);
  }, [orchestrator, dispatch, addSystemMessage, gracefulExit]);

  const tagsLine = agents.map((a) => `@${a.tag}`).join(", ");

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <text fg="#00BFFF">
        llm-party | {tagsLine} | /agents /history /session /save /changes /exit
      </text>

      {/* Chat area */}
      <box flexGrow={1}>
        <scrollbox height="100%">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} humanName={humanName} />
          ))}
        </scrollbox>
      </box>

      {/* Status bar */}
      <StatusBar
        agents={agents}
        agentStates={agentStates}
        sessionId={orchestrator.getSessionId()}
        stickyTarget={stickyTarget}
      />

      {/* Input: no fixed height, grows with content */}
      <InputLine
        humanName={humanName}
        onSubmit={handleSubmit}
        disabled={dispatching}
      />
    </box>
  );
}
