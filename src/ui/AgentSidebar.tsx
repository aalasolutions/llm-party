import { createSignal, For, Show } from "solid-js";
import type { AgentActivityEntry } from "../types.js";
import type { AgentState } from "./useOrchestrator.js";
import { ACTIVITY_SPINNERS, SPINNER_FRAMES, globalTick, toSuperscript } from "./constants.js";
import { COLORS } from "./theme.js";

interface Props {
  agents: Array<{ name: string; tag: string; provider: string }>;
  agentStates: Map<string, AgentState>;
  queueCounts?: Map<string, number>;
  width: number;

  agentDetails?: Map<string, string | undefined>;
  agentActivityLog?: Map<string, AgentActivityEntry[]>;
}

function truncateRight(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  return s.slice(0, max - 1) + "…";
}

export function AgentSidebar(props: Props) {
  const [expanded, setExpanded] = createSignal<Map<string, boolean>>(new Map());

  const getState = (name: string) => props.agentStates.get(name) ?? ("idle" as AgentState);
  const isActive = (s: AgentState) => s !== "idle" && s !== "error" && s !== "queued";

  const getExpanded = (name: string) => {
    const v = expanded().get(name);
    if (v !== undefined) return v;
    return isActive(getState(name));
  };

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Map(prev);
      next.set(name, !getExpanded(name));
      return next;
    });
  };

  const stateColor = (s: AgentState) => {
    if (s === "error") return COLORS.error;
    if (isActive(s)) return COLORS.success;
    return COLORS.textMuted;
  };

  const spinner = (s: AgentState) => {
    const t = globalTick();
    if (!isActive(s)) return " ";
    const frames = ACTIVITY_SPINNERS[s] ?? SPINNER_FRAMES;
    return frames[t % frames.length] ?? " ";
  };

  const detailText = (name: string) => props.agentDetails?.get(name) ?? "";
  const logEntries = (name: string) => props.agentActivityLog?.get(name) ?? [];

  return (
    <box
      width={props.width}
      height="100%"
      flexShrink={0}
      flexGrow={0}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={COLORS.borderStrong}
      paddingX={1}
    >
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text fg={COLORS.primary}><strong>Agents</strong></text>
        <text fg={COLORS.textFaint}>Ctrl+B</text>
      </box>
      <text fg={COLORS.borderStrong}>{"─".repeat(Math.max(0, props.width - 4))}</text>

      <Show when={props.agents.length === 0}>
        <text fg={COLORS.textFaint} selectable={false}>No agents configured.</text>
      </Show>

      <scrollbox width="100%" flexGrow={1} flexBasis={0} flexShrink={1}>
        <For each={props.agents}>{(a, i) => {
          const s = () => getState(a.name);
          const isOpen = () => getExpanded(a.name);
          const q = () => props.queueCounts?.get(a.name) ?? 0;
          const qSup = () => toSuperscript(q());

          const title = () => {
            const arrow = isOpen() ? "▼" : "▶";
            const state = s();
            return `${arrow} ${qSup()}${a.name} (${state}) ${spinner(state)}`;
          };

          return (
            <box width="100%" flexDirection="column" marginTop={i() === 0 ? 0 : 1}>
              <box width="100%" onMouseUp={() => toggle(a.name)}>
                <text fg={stateColor(s())} selectable={false}>{title()}</text>
              </box>

              <Show when={isOpen()}>
                <box flexDirection="column" paddingLeft={2}>
                  <For each={logEntries(a.name).slice(-8)}>{(e) => (
                    <text fg={COLORS.textDim} selectable={false}>
                      {e.detail ? truncateRight(e.detail, Math.max(0, props.width - 6)) : e.activity}
                    </text>
                  )}</For>
                  <Show when={logEntries(a.name).length === 0}>
                    <text fg={COLORS.textFaint} selectable={false}>No activity details yet.</text>
                  </Show>
                </box>
              </Show>
            </box>
          );
        }}</For>
      </scrollbox>

    </box>
  );
}
