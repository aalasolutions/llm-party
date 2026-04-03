import { createSignal, For } from "solid-js";
import type { AgentState } from "./useOrchestrator.js";
import { SPINNER_FRAMES, ACTIVITY_SPINNERS, SUPERSCRIPT_DIGITS } from "./constants.js";
import { COLORS } from "./theme.js";

interface Props {
  agents: Array<{ name: string; tag: string; provider: string }>;
  agentStates: Map<string, AgentState>;
  stickyTarget: string[] | undefined;
  queueCounts?: Map<string, number>;
}

const PULSE_COLORS = ["#005F87", "#0087AF", "#00AFD7", "#00D7FF", "#5FF", "#00D7FF", "#0087AF"];

// Global tick: one interval drives all animations. Never stops, never restarts.
const [globalTick, setGlobalTick] = createSignal(0);
setInterval(() => setGlobalTick((t) => t + 1), 80);

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
      </box>
    </box>
  );
}

function toSuperscript(n: number): string {
  if (n <= 0) return "";
  return String(n).split("").map((d) => SUPERSCRIPT_DIGITS[parseInt(d, 10)] ?? d).join("");
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
