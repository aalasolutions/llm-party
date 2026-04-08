import { For, Show } from "solid-js";
import type { AgentState } from "./useOrchestrator.js";
import { SPINNER_FRAMES, ACTIVITY_SPINNERS, globalTick, toSuperscript, PULSE_COLORS } from "./constants.js";
import { COLORS } from "./theme.js";

interface Props {
  agents: Array<{ name: string; tag: string; provider: string }>;
  agentStates: Map<string, AgentState>;
  stickyTarget: string[] | undefined;
  queueCounts?: Map<string, number>;
  /** When sidebar is visible, hide AgentChip activity indicators (they live in accordion titles instead) */
  sidebarVisible?: boolean;
}

export function StatusBar(props: Props) {
  const targetNames = () => props.stickyTarget ?? props.agents.map((a) => a.name);
  const isTargeted = (name: string) => targetNames().includes(name);

  return (
    <box paddingX={1} flexShrink={0}>
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <box flexDirection="row" gap={1}>
          <For each={props.agents}>{(a, i) => (
            <text>
              <span style={{ fg: isTargeted(a.name) ? COLORS.success : COLORS.textDim }}>
                @{a.tag}({a.provider})
              </span>
              {i() < props.agents.length - 1 ? <span style={{ fg: COLORS.textDim }}> </span> : null}
            </text>
          )}</For>
          <text fg={COLORS.textDim}>| /info</text>
        </box>
        <Show when={!props.sidebarVisible}>
          <box flexDirection="row">
            <For each={props.agents}>{(a, i) => (
              <>
                <AgentChip
                  name={a.name}
                  getState={() => props.agentStates.get(a.name) ?? "idle"}
                  getQueued={() => props.queueCounts?.get(a.name) ?? 0}
                />
                {i() < props.agents.length - 1 ? <text fg={COLORS.textDim}> │ </text> : null}
              </>
            )}</For>
          </box>
        </Show>
      </box>
    </box>
  );
}

function AgentChip(props: { name: string; getState: () => AgentState; getQueued: () => number }) {
  const isActive = () => {
    const s = props.getState();
    return s !== "idle" && s !== "error" && s !== "queued";
  };

  const frames = () => ACTIVITY_SPINNERS[props.getState()] ?? SPINNER_FRAMES;
  const tick = () => globalTick();

  const spinner = () => isActive() ? frames()[tick() % frames().length] : " ";
  const pulseColor = () => isActive() ? PULSE_COLORS[tick() % PULSE_COLORS.length] : COLORS.textMuted;
  const queueSlot = () => props.getQueued() > 0 ? toSuperscript(props.getQueued()) : " ";

  const stateColor = () => {
    if (props.getState() === "error") return COLORS.error;
    if (isActive()) return pulseColor();
    return COLORS.textMuted;
  };

  return (
    <text fg={stateColor()}>
      {queueSlot()}{props.name} {spinner()}{props.getState() === "error" ? " ERR" : ""}
    </text>
  );
}
