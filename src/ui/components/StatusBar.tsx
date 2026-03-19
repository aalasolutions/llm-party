import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { AgentState } from "../hooks/useOrchestrator.js";

interface StatusBarProps {
  agents: Array<{ name: string; tag: string; provider: string }>;
  agentStates: Map<string, AgentState>;
  sessionId: string;
  stickyTarget: string[] | undefined;
}

export function StatusBar({ agents, agentStates, sessionId, stickyTarget }: StatusBarProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingLeft={1} paddingRight={1}>
      <Box gap={2}>
        {agents.map((agent) => {
          const state = agentStates.get(agent.name) ?? "idle";
          return (
            <AgentIndicator key={agent.name} name={agent.name} state={state} />
          );
        })}
      </Box>
      <Box gap={2}>
        <Text dimColor>Session: {sessionId.slice(0, 20)}</Text>
        {stickyTarget && (
          <Text dimColor>Target: @{stickyTarget.join(", @")} (sticky)</Text>
        )}
      </Box>
    </Box>
  );
}

function AgentIndicator({ name, state }: { name: string; state: AgentState }): React.ReactElement {
  if (state === "thinking") {
    return (
      <Box>
        <Text color="cyan">{name} </Text>
        <Spinner type="dots" />
      </Box>
    );
  }

  if (state === "error") {
    return <Text color="red">{name} ✗ error</Text>;
  }

  return <Text dimColor>{name} ● idle</Text>;
}
