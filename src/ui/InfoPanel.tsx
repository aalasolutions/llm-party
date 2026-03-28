import { For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { COLORS } from "./theme.js";

interface InfoPanelProps {
  sessionId: string;
  onClose: () => void;
}

export function InfoPanel(props: InfoPanelProps) {
  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onClose();
      return;
    }
  });

  const totalW = 50;
  const pad = (str: string, width: number) => str + " ".repeat(Math.max(0, width - str.length));

  const cmdW = 16;
  const commands = [
    ["/agents", "Agent panel (Ctrl+P)"],
    ["/config", "Config wizard"],
    ["/info", "This panel"],
    ["/session", "Session details"],
    ["/save <path>", "Export as JSON"],
    ["/changes", "Git modified files"],
    ["/clear", "Clear chat (Ctrl+L)"],
    ["/exit", "Quit"],
  ];

  const shortcuts = [
    ["Ctrl+P", "Toggle agents panel"],
    ["Ctrl+L", "Clear chat"],
    ["Ctrl+C", "Copy or exit"],
    ["Ctrl+A", "Jump to start of line"],
    ["Ctrl+E", "Jump to end of line"],
    ["Ctrl+U", "Clear entire line"],
    ["Ctrl+W", "Delete word backward"],
    ["Shift+Enter", "New line"],
    ["Up/Down", "Input history"],
    ["PageUp/Down", "Scroll chat"],
  ];

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
          <text alignSelf="center" fg={COLORS.primary}><strong>llm-party</strong></text>

          <text fg={COLORS.textMuted} marginTop={1}>
            <span style={{ fg: COLORS.textDim }}>Session  </span>
            <span style={{ fg: COLORS.textPrimary }}>{props.sessionId.slice(0, 30)}</span>
          </text>

          <text fg={COLORS.primary} marginTop={1}><strong>Commands</strong></text>
          <text fg={COLORS.borderStrong}>{"─".repeat(totalW)}</text>
          <For each={commands}>{(entry) => (
            <text>
              <span style={{ fg: COLORS.success }}>{pad(entry[0]!, cmdW)}</span>
              <span style={{ fg: COLORS.textMuted }}>{entry[1]}</span>
            </text>
          )}</For>

          <text fg={COLORS.primary} marginTop={1}><strong>Shortcuts</strong></text>
          <text fg={COLORS.borderStrong}>{"─".repeat(totalW)}</text>
          <For each={shortcuts}>{(entry) => (
            <text>
              <span style={{ fg: COLORS.success }}>{pad(entry[0]!, cmdW)}</span>
              <span style={{ fg: COLORS.textMuted }}>{entry[1]}</span>
            </text>
          )}</For>

          <text fg={COLORS.borderStrong} marginTop={1}>{"─".repeat(totalW)}</text>
          <text marginTop={1} alignSelf="center">
            <span style={{ fg: COLORS.error }}>Esc</span>
            <span style={{ fg: COLORS.textFaint }}>{" close"}</span>
          </text>
        </box>
      </box>
    </box>
  );
}
