import React from "react";
import { Box, Text } from "ink";
import type { DisplayMessage } from "../../types.js";
import { formatAgentLabel } from "../../utils.js";

interface MessageBubbleProps {
  message: DisplayMessage;
  humanName: string;
}

export function MessageBubble({ message, humanName }: MessageBubbleProps): React.ReactElement {
  if (message.type === "system") {
    return (
      <Box marginBottom={0}>
        <Text dimColor>{message.text}</Text>
      </Box>
    );
  }

  if (message.type === "user") {
    return (
      <Box marginBottom={0}>
        <Text color="green" bold>[{humanName}]</Text>
        <Text> {message.text}</Text>
      </Box>
    );
  }

  const label = message.provider
    ? formatAgentLabel(message.from, message.provider)
    : message.from;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="magenta" bold>[{label}]</Text>
      </Box>
      <Box>
        <Text>{message.text}</Text>
      </Box>
    </Box>
  );
}
