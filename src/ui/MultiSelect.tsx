import { createSignal, For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { COLORS } from "./theme.js";

export interface MultiSelectItem {
  label: string;
  description: string;
  disabled?: boolean;
}

interface MultiSelectProps {
  items: MultiSelectItem[];
  onConfirm: (selectedIndices: number[]) => void;
  onCancel?: () => void;
  initialSelected?: number[];
}

export function MultiSelect(props: MultiSelectProps) {
  const [focused, setFocused] = createSignal(
    props.items.findIndex((item) => !item.disabled)
  );
  const [selected, setSelected] = createSignal<Set<number>>(
    new Set(props.initialSelected || [])
  );
  const [error, setError] = createSignal("");

  const findNextEnabled = (from: number, direction: 1 | -1): number => {
    let idx = from;
    for (let i = 0; i < props.items.length; i++) {
      idx = (idx + direction + props.items.length) % props.items.length;
      if (!props.items[idx].disabled) return idx;
    }
    return from;
  };

  useKeyboard((key) => {
    if (key.name === "up" || key.name === "k") {
      setFocused((f) => findNextEnabled(f, -1));
      setError("");
      return;
    }

    if (key.name === "down" || key.name === "j") {
      setFocused((f) => findNextEnabled(f, 1));
      setError("");
      return;
    }

    if (key.name === "space" || key.sequence === " ") {
      if (focused() >= 0 && !props.items[focused()].disabled) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(focused())) {
            next.delete(focused());
          } else {
            next.add(focused());
          }
          return next;
        });
        setError("");
      }
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      if (selected().size === 0) {
        setError("Select at least one agent");
        return;
      }
      props.onConfirm(Array.from(selected()).sort((a, b) => a - b));
      return;
    }

    if (key.name === "escape" && props.onCancel) {
      props.onCancel();
      return;
    }
  });

  return (
    <box flexDirection="column">
      <For each={props.items}>{(item, i) => {
        const isSelected = () => selected().has(i());
        const isFocused = () => i() === focused();
        const isDisabled = () => !!item.disabled;

        const bullet = () => isSelected() ? "●" : "○";
        const bulletColor = () => isDisabled() ? COLORS.textFaint : isSelected() ? COLORS.success : COLORS.textSecondary;
        const labelColor = () => isDisabled() ? COLORS.textSubtle : COLORS.textPrimary;
        const descColor = () => isDisabled() ? COLORS.textFaint : COLORS.textMuted;
        const bgColor = () => isFocused() && !isDisabled() ? COLORS.bgFocus : undefined;

        return (
          <text bg={bgColor()} selectable={false}>
            <span style={{ fg: bulletColor() }}> {bullet()} </span>
            <span style={{ fg: labelColor() }}>{item.label}</span>
            <span style={{ fg: descColor() }}>  {item.description}</span>
          </text>
        );
      }}</For>

      <Show when={error()}>
        <text fg={COLORS.error} marginTop={1}>
          {"  "}{error()}
        </text>
      </Show>
    </box>
  );
}
