import React from "react";
import { Box } from "ink";
import type { DisplayMessage } from "../../types.js";
import { MessageBubble } from "./MessageBubble.js";

interface ChatThreadProps {
  messages: DisplayMessage[];
  humanName: string;
}

export function ChatThread({ messages, humanName }: ChatThreadProps): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} humanName={humanName} />
      ))}
    </Box>
  );
}
