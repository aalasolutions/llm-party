import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
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
  addCustom?: {
    onAdd: (name: string) => void;
  };
}

export function MultiSelect(props: MultiSelectProps) {
  const [focused, setFocused] = createSignal(
    props.items.findIndex((item) => !item.disabled)
  );
  const [selected, setSelected] = createSignal<Set<number>>(
    new Set(props.initialSelected || [])
  );
  const [error, setError] = createSignal("");
  const [addingCustom, setAddingCustom] = createSignal(false);
  const [customName, setCustomName] = createSignal("");
  const [customCursor, setCustomCursor] = createSignal(0);

  const tuiRenderer = useRenderer();

  // Handle paste events for custom name input
  createEffect(() => {
    const handlePaste = (event: any) => {
      if (!addingCustom()) return;
      const text = new TextDecoder().decode(event.bytes);
      if (!text) return;
      const cleaned = text.replace(/\n/g, "");
      if (!cleaned) return;
      const c = customCursor();
      const val = customName();
      setCustomName(val.slice(0, c) + cleaned + val.slice(c));
      setCustomCursor(c + cleaned.length);
    };
    (tuiRenderer as any).keyInput.on("paste", handlePaste);
    onCleanup(() => { (tuiRenderer as any).keyInput.off("paste", handlePaste); });
  });

  // Total rows: items + (addCustom button if enabled)
  const totalRows = () => props.items.length + (props.addCustom ? 1 : 0);
  const isAddCustomRow = (idx: number) => props.addCustom && idx === props.items.length;

  const findNextEnabled = (from: number, direction: 1 | -1): number => {
    const total = totalRows();
    let idx = from;
    for (let i = 0; i < total; i++) {
      idx = (idx + direction + total) % total;
      if (isAddCustomRow(idx)) return idx;
      if (!props.items[idx].disabled) return idx;
    }
    return from;
  };

  useKeyboard((key) => {
    // While in text input mode for adding custom
    if (addingCustom()) {
      if (key.name === "escape") {
        setAddingCustom(false);
        setCustomName("");
        setCustomCursor(0);
        return;
      }

      if (key.name === "enter" || key.name === "return") {
        const name = customName().trim();
        if (name.length > 0) {
          props.addCustom!.onAdd(name);
          setAddingCustom(false);
          setCustomName("");
          setCustomCursor(0);
        }
        return;
      }

      if (key.name === "backspace") {
        const c = customCursor();
        if (c > 0) {
          const val = customName();
          setCustomName(val.slice(0, c - 1) + val.slice(c));
          setCustomCursor(c - 1);
        }
        return;
      }

      if (key.name === "delete") {
        const c = customCursor();
        const val = customName();
        if (c < val.length) {
          setCustomName(val.slice(0, c) + val.slice(c + 1));
        }
        return;
      }

      if (key.name === "left") {
        setCustomCursor((c) => Math.max(0, c - 1));
        return;
      }

      if (key.name === "right") {
        setCustomCursor((c) => Math.min(customName().length, c + 1));
        return;
      }

      if (key.name === "home" || (key.ctrl && key.name === "a")) {
        setCustomCursor(0);
        return;
      }

      if (key.name === "end" || (key.ctrl && key.name === "e")) {
        setCustomCursor(customName().length);
        return;
      }

      if (key.ctrl && key.name === "u") {
        setCustomName("");
        setCustomCursor(0);
        return;
      }

      // Skip non-printable
      if (key.ctrl || key.name === "up" || key.name === "down" ||
          key.name === "pageup" || key.name === "pagedown" || key.name === "tab") {
        return;
      }

      // Normal character input
      const ch = key.sequence;
      if (ch && ch.length > 0 && !ch.startsWith("\x1b")) {
        if (ch === "'" || ch === '"' || ch === "`") return;
        const c = customCursor();
        const val = customName();
        setCustomName(val.slice(0, c) + ch + val.slice(c));
        setCustomCursor(c + ch.length);
      }
      return;
    }

    // Normal list mode
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
      const f = focused();
      if (isAddCustomRow(f)) {
        setAddingCustom(true);
        setCustomName("");
        setCustomCursor(0);
        return;
      }
      if (f >= 0 && !props.items[f].disabled) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(f)) {
            next.delete(f);
          } else {
            next.add(f);
          }
          return next;
        });
        setError("");
      }
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      const f = focused();
      if (isAddCustomRow(f)) {
        setAddingCustom(true);
        setCustomName("");
        setCustomCursor(0);
        return;
      }
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
        const isFocused = () => i() === focused() && !addingCustom();
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

      {/* Add Custom row */}
      <Show when={props.addCustom}>
        <Show when={addingCustom()} fallback={
          <text bg={focused() === props.items.length && !addingCustom() ? COLORS.bgFocus : undefined} selectable={false}>
            <span style={{ fg: COLORS.primary }}> + </span>
            <span style={{ fg: COLORS.textSecondary }}>Add Custom...</span>
          </text>
        }>
          <text selectable={false}>
            <span style={{ fg: COLORS.primary }}> + </span>
            <span style={{ fg: COLORS.textSecondary }}>Name: </span>
            {customName().slice(0, customCursor())}
            <span style={{ bg: COLORS.textPrimary, fg: "#000000" }}>{customCursor() < customName().length ? customName()[customCursor()] : " "}</span>
            {customCursor() < customName().length ? customName().slice(customCursor() + 1) : ""}
          </text>
        </Show>
      </Show>

      <Show when={error()}>
        <text fg={COLORS.error} marginTop={1}>
          {"  "}{error()}
        </text>
      </Show>
    </box>
  );
}
