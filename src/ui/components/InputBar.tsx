import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface InputBarProps {
  humanName: string;
  onSubmit: (value: string) => void;
  disabled: boolean;
}

export function InputBar({ humanName, onSubmit, disabled }: InputBarProps): React.ReactElement {
  const [value, setValue] = useState("");

  const handleSubmit = (submitted: string): void => {
    const trimmed = submitted.trim();
    if (!trimmed) return;
    setValue("");
    onSubmit(trimmed);
  };

  return (
    <Box borderStyle="single" borderColor={disabled ? "gray" : "green"} paddingLeft={1} paddingRight={1}>
      <Text color={disabled ? "gray" : "green"} bold>{humanName} &gt; </Text>
      {disabled ? (
        <Text dimColor>waiting for agents...</Text>
      ) : (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder="Type a message or /command..."
        />
      )}
    </Box>
  );
}
