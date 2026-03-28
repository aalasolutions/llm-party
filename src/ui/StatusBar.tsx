import { useState, useEffect } from "react";
import type { AgentState } from "./useOrchestrator.js";
import { SPINNER_FRAMES } from "./constants.js";
import { COLORS } from "./theme.js";

interface Props {
  agents: Array<{ name: string; tag: string; provider: string }>;
  agentStates: Map<string, AgentState>;
  stickyTarget: string[] | undefined;
}
// Color cycle: pulses through cyan/blue shades
const PULSE_COLORS = ["#005F87", "#0087AF", "#00AFD7", "#00D7FF", "#5FF", "#00D7FF", "#0087AF"];

function useThinkingAnimation(active: boolean): { spinner: string; color: string } {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) { setFrame(0); return; }
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % (SPINNER_FRAMES.length * PULSE_COLORS.length));
    }, 80);
    return () => clearInterval(interval);
  }, [active]);

  return {
    spinner: active ? SPINNER_FRAMES[frame % SPINNER_FRAMES.length] : "",
    color: active ? PULSE_COLORS[frame % PULSE_COLORS.length] : COLORS.textMuted,
  };
}

export function StatusBar({ agents, agentStates, stickyTarget }: Props) {
  const targetNames = stickyTarget ?? agents.map((a) => a.name);
  const isTargeted = (name: string) => targetNames.includes(name);

  return (
    <box paddingX={1} flexShrink={0}>
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <box flexDirection="row" gap={1}>
          {agents.map((a, i) => (
            <text key={a.name}>
              <span fg={isTargeted(a.name) ? COLORS.success : COLORS.textDim}>
                @{a.tag}({a.provider})
              </span>
              {i < agents.length - 1 ? <span fg={COLORS.textDim}> </span> : null}
            </text>
          ))}
          <text fg={COLORS.textDim}>| /info</text>
        </box>
        <box flexDirection="row" gap={2}>
          {agents.map((a) => (
            <AgentChip key={a.name} name={a.name} state={agentStates.get(a.name) ?? "idle"} />
          ))}
        </box>
      </box>
    </box>
  );
}

function AgentChip({ name, state }: { name: string; state: AgentState }) {
  const { spinner, color } = useThinkingAnimation(state === "thinking");

  if (state === "error") {
    return <text fg={COLORS.error}>{name} ERR</text>;
  }

  if (state === "thinking") {
    return <text fg={color}>{name} {spinner}</text>;
  }

  return <text fg={COLORS.textMuted}>{name}</text>;
}
