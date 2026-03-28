import { For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { COLORS } from "./theme.js";

interface AgentInfo {
  name: string;
  tag: string;
  provider: string;
  model: string;
}

interface AgentsPanelProps {
  agents: AgentInfo[];
  onClose: () => void;
  onConfig: () => void;
}

export function AgentsPanel(props: AgentsPanelProps) {
  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onClose();
      return;
    }
  });

  const nameW = () => Math.max(4, ...props.agents.map((a) => a.name.length)) + 2;
  const tagW = () => Math.max(3, ...props.agents.map((a) => a.tag.length + 1)) + 2;
  const provW = () => Math.max(8, ...props.agents.map((a) => a.provider.length)) + 2;
  const modelW = () => Math.max(5, ...props.agents.map((a) => a.model.length)) + 2;
  const totalW = () => nameW() + tagW() + provW() + modelW();

  const pad = (str: string, width: number) => str + " ".repeat(Math.max(0, width - str.length));

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      zIndex={10}
    >
      <box
        border
        borderStyle="rounded"
        borderColor={COLORS.primary}
        paddingX={3}
        paddingY={1}
        backgroundColor={COLORS.bgPanel}
      >
        <box flexDirection="column">
          <text alignSelf="center" fg={COLORS.primary}><strong>Active Agents</strong></text>

          <text fg={COLORS.textSubtle} marginTop={1}>
            <span style={{ fg: COLORS.textMuted }}>{pad("Name", nameW())}</span>
            <span style={{ fg: COLORS.textMuted }}>{pad("Tag", tagW())}</span>
            <span style={{ fg: COLORS.textMuted }}>{pad("Provider", provW())}</span>
            <span style={{ fg: COLORS.textMuted }}>{pad("Model", modelW())}</span>
          </text>
          <text fg={COLORS.borderStrong}>{"─".repeat(totalW())}</text>

          <For each={props.agents}>{(a) => (
            <text>
              <span style={{ fg: COLORS.textPrimary }}>{pad(a.name, nameW())}</span>
              <span style={{ fg: COLORS.success }}>{pad("@" + a.tag, tagW())}</span>
              <span style={{ fg: COLORS.textMuted }}>{pad(a.provider, provW())}</span>
              <span style={{ fg: COLORS.textDim }}>{pad(a.model, modelW())}</span>
            </text>
          )}</For>

          <text fg={COLORS.borderStrong} marginTop={1}>{"─".repeat(totalW())}</text>

          <text marginTop={1} alignSelf="center">
            <span style={{ fg: COLORS.error }}>Esc</span>
            <span style={{ fg: COLORS.textFaint }}>{" close   "}</span>
            <span style={{ fg: COLORS.success }}>/config</span>
            <span style={{ fg: COLORS.textFaint }}>{" edit agents"}</span>
          </text>
        </box>
      </box>
    </box>
  );
}
