import { createSignal, createEffect, onCleanup, For, Switch, Match } from "solid-js";
import type { AgentState } from "./useOrchestrator.js";
import { SPINNER_FRAMES, ACTIVITY_SPINNERS } from "./constants.js";
import { COLORS } from "./theme.js";

interface Props {
  agents: Array<{ name: string; tag: string; provider: string }>;
  agentStates: Map<string, AgentState>;
  stickyTarget: string[] | undefined;
}
// Color cycle: pulses through cyan/blue shades
const PULSE_COLORS = ["#005F87", "#0087AF", "#00AFD7", "#00D7FF", "#5FF", "#00D7FF", "#0087AF"];

function useThinkingAnimation(active: () => boolean): { spinner: () => string; color: () => string } {
  const [frame, setFrame] = createSignal(0);

  createEffect(() => {
    if (!active()) { setFrame(0); return; }
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % (SPINNER_FRAMES.length * PULSE_COLORS.length));
    }, 80);
    onCleanup(() => clearInterval(interval));
  });

  return {
    spinner: () => active() ? SPINNER_FRAMES[frame() % SPINNER_FRAMES.length] : "",
    color: () => active() ? PULSE_COLORS[frame() % PULSE_COLORS.length] : COLORS.textMuted,
  };
}

function useActivityAnimation(active: () => boolean, frames: () => string[]): { spinner: () => string; color: () => string } {
  const [frame, setFrame] = createSignal(0);

  createEffect(() => {
    if (!active()) { setFrame(0); return; }
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % (frames().length * PULSE_COLORS.length));
    }, 80);
    onCleanup(() => clearInterval(interval));
  });

  return {
    spinner: () => active() ? frames()[frame() % frames().length] : "",
    color: () => active() ? PULSE_COLORS[frame() % PULSE_COLORS.length] : COLORS.textMuted,
  };
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
        <box flexDirection="row" gap={2}>
          <For each={props.agents}>{(a) => (
            <AgentChip name={a.name} state={props.agentStates.get(a.name) ?? "idle"} />
          )}</For>
        </box>
      </box>
    </box>
  );
}

function AgentChip(props: { name: string; state: AgentState }) {
  const isActive = () => props.state !== "idle" && props.state !== "error";
  const frames = () => ACTIVITY_SPINNERS[props.state] ?? SPINNER_FRAMES;
  const { spinner, color } = useActivityAnimation(isActive, frames);

  return (
    <Switch fallback={<text fg={COLORS.textMuted}>{props.name}</text>}>
      <Match when={props.state === "error"}>
        <text fg={COLORS.error}>{props.name} ERR</text>
      </Match>
      <Match when={isActive()}>
        <text fg={color()}>{props.name} {spinner()}</text>
      </Match>
    </Switch>
  );
}
