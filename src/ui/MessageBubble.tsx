import type { DisplayMessage } from "../types.js";
import { formatAgentLabel } from "../utils.js";
import { COLORS } from "./theme.js";

interface Props {
  message: DisplayMessage;
  humanName: string;
}

export function MessageBubble(props: Props) {
  if (props.message.type === "system") {
    return (
      <text fg={COLORS.textDim} selectable>{props.message.text}</text>
    );
  }

  if (props.message.type === "user") {
    return (
      <text selectable>
        <span style={{ fg: COLORS.human }}><strong>[{props.humanName}]</strong></span> {props.message.text}
      </text>
    );
  }

  const label = props.message.tag
    ? formatAgentLabel(props.message.from, props.message.tag)
    : props.message.from;

  return (
    <box flexDirection="column" marginBottom={1}>
      <text selectable>
        <span style={{ fg: COLORS.agent }}><strong>[{label}]</strong></span>
      </text>
      <text selectable>{props.message.text}</text>
    </box>
  );
}
