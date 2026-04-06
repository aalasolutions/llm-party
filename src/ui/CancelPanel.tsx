import { createSignal, createEffect, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { COLORS } from "./theme.js";

interface CancelPanelProps {
  activeAgents: string[];
  onCancel: (names: string[]) => void;
  onClose: () => void;
}

export function CancelPanel(props: CancelPanelProps) {
  const items = () => props.activeAgents;
  const [cursor, setCursor] = createSignal(0);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());

  // Auto-close when all agents finish
  createEffect(() => {
    if (props.activeAgents.length === 0) {
      props.onClose();
    }
  });

  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onClose();
      return;
    }

    if (key.name === "return") {
      const sel = selected();
      if (sel.size === 0) {
        props.onClose();
        return;
      }
      const names = [...sel];
      props.onCancel(names);
      return;
    }

    if (key.name === "up") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }

    if (key.name === "down") {
      setCursor((c) => Math.min(items().length - 1, c + 1));
      return;
    }

    if (key.name === "space" || key.sequence === " ") {
      const item = items()[cursor()];
      if (!item) return;

      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item)) {
          next.delete(item);
        } else {
          next.add(item);
        }
        return next;
      });
      return;
    }
  });

  const totalW = 40;

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
        borderColor={COLORS.error}
        paddingX={3}
        paddingY={1}
        backgroundColor={COLORS.bgPanel}
      >
        <box flexDirection="column">
          <text alignSelf="center" fg={COLORS.error}><strong>Cancel Agents</strong></text>

          <text fg={COLORS.borderStrong} marginTop={1}>{"─".repeat(totalW)}</text>

          <For each={items()}>{(item, i) => {
            const isSelected = () => selected().has(item);
            const isCursor = () => cursor() === i();
            const bullet = () => isSelected() ? "■" : "□";
            const bulletColor = () => isSelected() ? COLORS.error : COLORS.textDim;
            const labelColor = () => isCursor() ? COLORS.textPrimary : COLORS.textMuted;
            const bgColor = () => isCursor() ? COLORS.bgFocus : undefined;

            return (
              <text bg={bgColor()} selectable={false}>
                <span style={{ fg: bulletColor() }}> {bullet()} </span>
                <span style={{ fg: labelColor() }}>{item}</span>
              </text>
            );
          }}</For>

          <text fg={COLORS.borderStrong} marginTop={1}>{"─".repeat(totalW)}</text>

          <text marginTop={1} alignSelf="center">
            <span style={{ fg: COLORS.textFaint }}>Space</span>
            <span style={{ fg: COLORS.textDim }}>{" toggle   "}</span>
            <span style={{ fg: COLORS.error }}>Enter</span>
            <span style={{ fg: COLORS.textDim }}>{" kill   "}</span>
            <span style={{ fg: COLORS.textFaint }}>Esc</span>
            <span style={{ fg: COLORS.textDim }}>{" back"}</span>
          </text>
        </box>
      </box>
    </box>
  );
}
