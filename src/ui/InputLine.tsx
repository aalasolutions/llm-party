import { createSignal, createEffect, onCleanup } from "solid-js";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { COLORS } from "./theme.js";

interface Props {
  humanName: string;
  onSubmit: (value: string) => void;
  disabled: boolean;
  disabledMessage?: string;
}

// Function key names to ignore (but NOT the letter "f")
const FUNCTION_KEYS = new Set([
  "f1", "f2", "f3", "f4", "f5", "f6",
  "f7", "f8", "f9", "f10", "f11", "f12",
]);

export function InputLine(props: Props) {
  let value = "";
  let cursor = 0;
  let history: string[] = [];
  let historyIndex = -1;
  let savedInput = "";

  const [tick, setTick] = createSignal(0);
  const tuiRenderer = useRenderer();
  const dims = useTerminalDimensions();

  // Force a reactive update so JSX re-evaluates
  const update = (newValue: string, newCursor: number) => {
    value = newValue;
    cursor = newCursor;
    setTick((n) => n + 1);
  };

  // Handle paste events from terminal
  createEffect(() => {
    const isDisabled = props.disabled;
    const handlePaste = (event: any) => {
      if (isDisabled) return;
      const text = new TextDecoder().decode(event.bytes);
      if (!text) return;
      update(value.slice(0, cursor) + text + value.slice(cursor), cursor + text.length);
    };
    tuiRenderer.keyInput.on("paste", handlePaste);
    onCleanup(() => { tuiRenderer.keyInput.off("paste", handlePaste); });
  });

  useKeyboard((key) => {
    if (props.disabled) return;

    // Shift+Enter or Option+Enter: insert newline
    if ((key.shift || key.option || key.meta) && (key.name === "enter" || key.name === "return")) {
      update(value.slice(0, cursor) + "\n" + value.slice(cursor), cursor + 1);
      return;
    }

    // Enter: submit
    if (key.name === "enter" || key.name === "return") {
      const trimmed = value.trim();
      if (trimmed) {
        history.push(trimmed);
        historyIndex = -1;
        props.onSubmit(trimmed);
      }
      update("", 0);
      return;
    }

    // Backspace: single char (Option+Backspace also lands here, no modifier detected)
    if (key.name === "backspace") {
      if (cursor > 0) {
        update(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
      }
      return;
    }

    // Command+Delete (fn+Cmd+Backspace): clear to end of line
    if ((key as any).super && key.name === "delete") {
      update(value.slice(0, cursor), cursor);
      return;
    }

    // Delete (fn+Backspace): single char
    if (key.name === "delete") {
      if (cursor < value.length) {
        update(value.slice(0, cursor) + value.slice(cursor + 1), cursor);
      }
      return;
    }

    // Option+Left: terminal sends Meta+B (Emacs readline)
    if (key.meta && key.name === "b") {
      const before = value.slice(0, cursor);
      const m = before.match(/\S+\s*$/);
      update(value, m ? cursor - m[0].length : 0);
      return;
    }

    // Option+Right: terminal sends Meta+F (Emacs readline)
    if (key.meta && key.name === "f") {
      const after = value.slice(cursor);
      const m = after.match(/^\s*\S+/);
      update(value, m ? cursor + m[0].length : value.length);
      return;
    }

    // Option+Backspace: terminal sends Meta+DEL, check raw sequence \x1b\x7f
    if (key.sequence === "\x1b\x7f") {
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const m = before.match(/\S+\s*$/);
      if (m) {
        update(before.slice(0, before.length - m[0].length) + after, cursor - m[0].length);
      }
      return;
    }

    // Left arrow: one character
    if (key.name === "left") {
      update(value, Math.max(0, cursor - 1));
      return;
    }

    // Right arrow: one character
    if (key.name === "right") {
      update(value, Math.min(value.length, cursor + 1));
      return;
    }

    // Home / Ctrl+A
    if (key.name === "home" || (key.ctrl && key.name === "a")) {
      update(value, 0);
      return;
    }

    // End / Ctrl+E
    if (key.name === "end" || (key.ctrl && key.name === "e")) {
      update(value, value.length);
      return;
    }

    // Ctrl+U: clear
    if (key.ctrl && key.name === "u") {
      update("", 0);
      return;
    }

    // Ctrl+W: delete word backward
    if (key.ctrl && key.name === "w") {
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const m = before.match(/\S+\s*$/);
      if (m) {
        update(before.slice(0, before.length - m[0].length) + after, cursor - m[0].length);
      }
      return;
    }

    // Up arrow: previous input history
    if (key.name === "up") {
      if (history.length === 0) return;
      if (historyIndex === -1) savedInput = value;
      const newIndex = Math.min(history.length - 1, historyIndex + 1);
      historyIndex = newIndex;
      const entry = history[history.length - 1 - newIndex];
      update(entry, entry.length);
      return;
    }

    // Down arrow: next input history or restore saved input
    if (key.name === "down") {
      if (historyIndex === -1) return;
      const newIndex = historyIndex - 1;
      historyIndex = newIndex;
      if (newIndex === -1) {
        update(savedInput, savedInput.length);
      } else {
        const entry = history[history.length - 1 - newIndex];
        update(entry, entry.length);
      }
      return;
    }

    // Skip non-printable keys
    if (key.ctrl || key.name === "escape" ||
        key.name === "tab" || key.name === "pageup" || key.name === "pagedown" ||
        key.name === "insert" || FUNCTION_KEYS.has(key.name)) {
      return;
    }

    // Normal character
    const ch = key.sequence;
    if (ch && ch.length > 0 && !ch.startsWith("\x1b")) {
      update(value.slice(0, cursor) + ch + value.slice(cursor), cursor + ch.length);
    }
  });

  // Read tick() so Solid tracks it and re-runs this derived computation
  const currentValue = () => { tick(); return value; };
  const currentCursor = () => { tick(); return cursor; };

  const borderColor = () => props.disabled ? COLORS.borderDim : COLORS.borderActive;
  const label = () => `${props.humanName} > `;
  const separator = () => "─".repeat(Math.max(0, dims().width - 2));

  return (
    <box flexDirection="column" paddingX={1} width="100%" flexShrink={0}>
      <text fg={borderColor()}>{separator()}</text>
      {props.disabled ? (
        (() => {
          const msg = props.disabledMessage !== undefined ? props.disabledMessage : "waiting for agents...";
          return msg ? (
            <text fg={COLORS.textDim}>{label()}{msg}</text>
          ) : (
            <text fg={COLORS.textDim}>{label()}</text>
          );
        })()
      ) : currentValue().length === 0 ? (
        <text>
          <span style={{ fg: COLORS.human }}><strong>{label()}</strong></span>
          <span style={{ bg: COLORS.textPrimary, fg: "#000000" }}> </span>
          <span style={{ fg: COLORS.textFaint }}> Type a message or /command...</span>
        </text>
      ) : (
        (() => {
          const v = currentValue();
          const c = currentCursor();
          const before = v.slice(0, c);
          const cursorChar = c < v.length ? v[c] : " ";
          const after = c < v.length ? v.slice(c + 1) : "";
          return (
            <text>
              <span style={{ fg: COLORS.human }}><strong>{label()}</strong></span>
              {before}
              <span style={{ bg: COLORS.textPrimary, fg: "#000000" }}>{cursorChar}</span>
              {after}
            </text>
          );
        })()
      )}
    </box>
  );
}
