import React from "react";
import type { DisplayMessage } from "../types.js";
import { formatAgentLabel } from "../utils.js";

interface Props {
  message: DisplayMessage;
  humanName: string;
}

export function MessageBubble({ message, humanName }: Props) {
  if (message.type === "system") {
    return (
      <text fg="#666666">{message.text}</text>
    );
  }

  if (message.type === "user") {
    return (
      <text>
        <span fg="#00FF00"><strong>[{humanName}]</strong></span> {message.text}
      </text>
    );
  }

  // Agent message: label on one line, content below
  const label = message.provider
    ? formatAgentLabel(message.from, message.provider)
    : message.from;

  return (
    <box flexDirection="column" marginBottom={1}>
      <text>
        <span fg="#FF00FF"><strong>[{label}]</strong></span>
      </text>
      <text>{message.text}</text>
    </box>
  );
}
