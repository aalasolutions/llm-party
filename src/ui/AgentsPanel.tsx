import { useKeyboard } from "@opentui/react";

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

export function AgentsPanel({ agents, onClose, onConfig }: AgentsPanelProps) {
  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
  });

  // Calculate column widths from data
  const nameW = Math.max(4, ...agents.map((a) => a.name.length)) + 2;
  const tagW = Math.max(3, ...agents.map((a) => a.tag.length + 1)) + 2;
  const provW = Math.max(8, ...agents.map((a) => a.provider.length)) + 2;
  const modelW = Math.max(5, ...agents.map((a) => a.model.length)) + 2;
  const totalW = nameW + tagW + provW + modelW;

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
        borderColor="#00BFFF"
        paddingX={3}
        paddingY={1}
        backgroundColor="#0d0d1a"
      >
        <box flexDirection="column">
          <text alignSelf="center" fg="#00BFFF"><strong>Active Agents</strong></text>

          {/* Table header */}
          <text fg="#555555" marginTop={1}>
            <span fg="#888888">{pad("Name", nameW)}</span>
            <span fg="#888888">{pad("Tag", tagW)}</span>
            <span fg="#888888">{pad("Provider", provW)}</span>
            <span fg="#888888">{pad("Model", modelW)}</span>
          </text>
          <text fg="#333333">{"─".repeat(totalW)}</text>

          {/* Agent rows */}
          {agents.map((a) => (
            <text key={a.name}>
              <span fg="#FFFFFF">{pad(a.name, nameW)}</span>
              <span fg="#00FF88">{pad("@" + a.tag, tagW)}</span>
              <span fg="#888888">{pad(a.provider, provW)}</span>
              <span fg="#666666">{pad(a.model, modelW)}</span>
            </text>
          ))}

          <text fg="#333333" marginTop={1}>{"─".repeat(totalW)}</text>

          {/* Footer hints */}
          <text marginTop={1} alignSelf="center">
            <span fg="#FF4444">Esc</span>
            <span fg="#444444">{" close   "}</span>
            <span fg="#00FF88">/config</span>
            <span fg="#444444">{" edit agents"}</span>
          </text>
        </box>
      </box>
    </box>
  );
}
