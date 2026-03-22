import { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";

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

export function MultiSelect({ items, onConfirm, onCancel, initialSelected }: MultiSelectProps) {
  const [focused, setFocused] = useState(() => {
    // Start on first non-disabled item
    return items.findIndex((item) => !item.disabled);
  });
  const [selected, setSelected] = useState<Set<number>>(() => {
    return new Set(initialSelected || []);
  });
  const [error, setError] = useState("");

  const findNextEnabled = useCallback(
    (from: number, direction: 1 | -1): number => {
      let idx = from;
      for (let i = 0; i < items.length; i++) {
        idx = (idx + direction + items.length) % items.length;
        if (!items[idx].disabled) return idx;
      }
      return from;
    },
    [items]
  );

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
      if (focused >= 0 && !items[focused].disabled) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(focused)) {
            next.delete(focused);
          } else {
            next.add(focused);
          }
          return next;
        });
        setError("");
      }
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      if (selected.size === 0) {
        setError("Select at least one agent");
        return;
      }
      onConfirm(Array.from(selected).sort((a, b) => a - b));
      return;
    }

    if (key.name === "escape" && onCancel) {
      onCancel();
      return;
    }
  });

  return (
    <box flexDirection="column">
      {items.map((item, i) => {
        const isSelected = selected.has(i);
        const isFocused = i === focused;
        const isDisabled = !!item.disabled;

        const bullet = isSelected ? "●" : "○";
        const bulletColor = isDisabled ? "#444444" : isSelected ? "#00FF88" : "#AAAAAA";
        const labelColor = isDisabled ? "#555555" : "#FFFFFF";
        const descColor = isDisabled ? "#444444" : "#888888";
        const bgColor = isFocused && !isDisabled ? "#1a1a2e" : undefined;

        return (
          <text key={i} bg={bgColor} selectable={false}>
            <span fg={bulletColor}> {bullet} </span>
            <span fg={labelColor}>{item.label}</span>
            <span fg={descColor}>  {item.description}</span>
          </text>
        );
      })}

      {error && (
        <text fg="#FF4444" marginTop={1}>
          {"  "}{error}
        </text>
      )}
    </box>
  );
}
