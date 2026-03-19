import React, { useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Orchestrator } from "../orchestrator.js";
import { useOrchestrator } from "./hooks/useOrchestrator.js";
import { ChatThread } from "./components/ChatThread.js";
import { InputBar } from "./components/InputBar.js";
import { StatusBar } from "./components/StatusBar.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";

interface AppProps {
  orchestrator: Orchestrator;
  maxAutoHops: number;
}

export function App({ orchestrator, maxAutoHops }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { rows } = useTerminalSize();
  const { messages, agentStates, stickyTarget, dispatching, dispatch, addSystemMessage } =
    useOrchestrator(orchestrator, maxAutoHops);
  const humanName = orchestrator.getHumanName();
  const agents = orchestrator.listAgents();

  const handleSubmit = useCallback(async (line: string) => {
    if (line === "/exit") {
      const adapters = orchestrator.getAdapters();
      await Promise.allSettled(adapters.map((a) => a.destroy()));
      exit();
      return;
    }

    if (line === "/agents") {
      const agentList = orchestrator.listAgents();
      const text = agentList
        .map((a) => `${a.name} tag=@${a.tag} provider=${a.provider} model=${a.model}`)
        .join("\n");
      addSystemMessage(text);
      return;
    }

    if (line === "/history") {
      const history = orchestrator.getHistory();
      const text = history
        .map((msg) => `${msg.createdAt} [${msg.from}] ${msg.text}`)
        .join("\n");
      addSystemMessage(text || "No history yet.");
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
      if (!filePath) {
        addSystemMessage("Usage: /save <path>");
        return;
      }
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
  }, [orchestrator, dispatch, addSystemMessage, exit]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      const adapters = orchestrator.getAdapters();
      Promise.allSettled(adapters.map((a) => a.destroy())).then(() => exit());
    }
  });

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexDirection="column" flexGrow={1}>
        <Text color="cyan" dimColor>
          llm-party | Tags: {agents.map((a) => `@${a.tag}`).join(", ")} | /agents /history /session /save /changes /exit
        </Text>
        <ChatThread messages={messages} humanName={humanName} />
      </Box>
      <StatusBar
        agents={agents}
        agentStates={agentStates}
        sessionId={orchestrator.getSessionId()}
        stickyTarget={stickyTarget}
      />
      <InputBar humanName={humanName} onSubmit={handleSubmit} disabled={dispatching} />
    </Box>
  );
}
