import React from "react";
import type { DisplayMessage } from "../types.js";
import { formatAgentLabel } from "../utils.js";
import { COLORS } from "./theme.js";

interface Props {
  message: DisplayMessage;
  humanName: string;
}

export function MessageBubble({ message, humanName }: Props) {
  if (message.type === "system") {
    return (
      <text fg={COLORS.textDim} selectable>{message.text}</text>
    );
  }

  if (message.type === "user") {
    return (
      <text selectable>
        <span fg={COLORS.human}><strong>[{humanName}]</strong></span> {message.text}
      </text>
    );
  }

  const label = message.tag
    ? formatAgentLabel(message.from, message.tag)
    : message.from;

  return (
    <box flexDirection="column" marginBottom={1}>
      <text selectable>
        <span fg={COLORS.agent}><strong>[{label}]</strong></span>
      </text>
      <text selectable>{message.text}</text>
    </box>
  );
}
