import React, { useState, useRef } from "react";
import { useKeyboard } from "@opentui/react";

interface Props {
  humanName: string;
  onSubmit: (value: string) => void;
  disabled: boolean;
}

// Function key names to ignore (but NOT the letter "f")
const FUNCTION_KEYS = new Set([
  "f1", "f2", "f3", "f4", "f5", "f6",
  "f7", "f8", "f9", "f10", "f11", "f12",
]);

export function InputLine({ humanName, onSubmit, disabled }: Props) {
  const valueRef = useRef("");
  const cursorRef = useRef(0);
  const [, forceRender] = useState(0);

  // Use refs for value/cursor to avoid re-rendering parent on every keystroke.
  // Only this component re-renders via forceRender.
  const update = (newValue: string, newCursor: number) => {
    valueRef.current = newValue;
    cursorRef.current = newCursor;
    forceRender((n) => n + 1);
  };

  useKeyboard((key) => {
    if (disabled) return;

    const value = valueRef.current;
    const cursor = cursorRef.current;

    // Shift+Enter: insert newline
    if (key.shift && (key.name === "enter" || key.name === "return")) {
      update(value.slice(0, cursor) + "\n" + value.slice(cursor), cursor + 1);
      return;
    }

    // Enter: submit
    if (key.name === "enter" || key.name === "return") {
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
      update("", 0);
      return;
    }

    // Option+Backspace: delete word backward
    if ((key.option || key.meta) && key.name === "backspace") {
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const m = before.match(/\S+\s*$/);
      if (m) {
        update(before.slice(0, before.length - m[0].length) + after, cursor - m[0].length);
      }
      return;
    }

    // Backspace: single char
    if (key.name === "backspace") {
      if (cursor > 0) {
        update(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
      }
      return;
    }

    // Option+Delete: delete word forward
    if ((key.option || key.meta) && key.name === "delete") {
      const after = value.slice(cursor);
      const m = after.match(/^\s*\S+/);
      if (m) {
        update(value.slice(0, cursor) + after.slice(m[0].length), cursor);
      }
      return;
    }

    // Delete: single char
    if (key.name === "delete") {
      if (cursor < value.length) {
        update(value.slice(0, cursor) + value.slice(cursor + 1), cursor);
      }
      return;
    }

    // Left arrow
    if (key.name === "left") {
      if (key.option || key.meta) {
        const before = value.slice(0, cursor);
        const m = before.match(/\S+\s*$/);
        update(value, m ? cursor - m[0].length : 0);
      } else {
        update(value, Math.max(0, cursor - 1));
      }
      return;
    }

    // Right arrow
    if (key.name === "right") {
      if (key.option || key.meta) {
        const after = value.slice(cursor);
        const m = after.match(/^\s*\S+/);
        update(value, m ? cursor + m[0].length : value.length);
      } else {
        update(value, Math.min(value.length, cursor + 1));
      }
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

    // Skip non-printable keys
    if (key.ctrl || key.name === "escape" || key.name === "up" || key.name === "down" ||
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

  const value = valueRef.current;
  const cursor = cursorRef.current;
  const borderColor = disabled ? "#555555" : "#00FF00";
  const label = `${humanName} > `;

  if (disabled) {
    return (
      <box border borderStyle="single" borderColor={borderColor} paddingX={1}>
        <text fg="#666666">{label}waiting for agents...</text>
      </box>
    );
  }

  if (value.length === 0) {
    return (
      <box border borderStyle="single" borderColor={borderColor} paddingX={1}>
        <text>
          <span fg="#00FF00"><strong>{label}</strong></span>
          <span bg="#FFFFFF" fg="#000000"> </span>
          <span fg="#444444"> Type a message or /command...</span>
        </text>
      </box>
    );
  }

  const before = value.slice(0, cursor);
  const cursorChar = cursor < value.length ? value[cursor] : " ";
  const after = cursor < value.length ? value.slice(cursor + 1) : "";

  return (
    <box border borderStyle="single" borderColor={borderColor} paddingX={1}>
      <text>
        <span fg="#00FF00"><strong>{label}</strong></span>
        {before}
        <span bg="#FFFFFF" fg="#000000">{cursorChar}</span>
        {after}
      </text>
    </box>
  );
}
