import { useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { PROVIDERS } from "../config/defaults.js";
import { detectProviders, type DetectionResult } from "../config/detector.js";
import { writeWizardConfig, type AgentOverride } from "../config/writer.js";
import { MultiSelect, type MultiSelectItem } from "./MultiSelect.js";

type WizardStep = "detect" | "providers" | "configure" | "done";

interface ConfigWizardProps {
  isFirstRun: boolean;
  onComplete: () => void;
  onCancel?: () => void;
}

interface AgentConfig {
  id: string;
  name: string;
  tag: string;
  model: string;
}

// Braille spinner frames for detection step
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function useSpinner(): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(interval);
  }, []);
  return SPINNER[frame];
}

export function ConfigWizard({ isFirstRun, onComplete, onCancel }: ConfigWizardProps) {
  const [step, setStep] = useState<WizardStep>("detect");
  const [detection, setDetection] = useState<DetectionResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [focusedField, setFocusedField] = useState(0); // 0=name, 1=tag, 2=model
  const [error, setError] = useState("");
  const [, forceRender] = useState(0);

  // Use refs for input values to avoid parent re-renders on keystroke
  const inputRefs = useRef<AgentConfig[]>([]);
  const cursorRef = useRef(0);

  const spinner = useSpinner();

  // Run detection on mount
  useEffect(() => {
    detectProviders().then((results) => {
      setDetection(results);
      setStep("providers");
    });
  }, []);

  // Build MultiSelect items from detection results
  const multiSelectItems: MultiSelectItem[] = PROVIDERS.map((provider) => {
    const result = detection.find((d) => d.id === provider.id);
    const available = result?.available ?? false;
    return {
      label: provider.displayName,
      description: available ? provider.description : provider.unavailableHint,
      disabled: !available,
    };
  });

  const handleProviderConfirm = useCallback(
    (selectedIndices: number[]) => {
      const ids = selectedIndices.map((i) => PROVIDERS[i].id);
      setSelectedIds(ids);

      const configs = ids.map((id) => {
        const def = PROVIDERS.find((p) => p.id === id)!;
        return {
          id: def.id,
          name: def.displayName,
          tag: def.defaultTag,
          model: def.defaultModel,
        };
      });

      setAgentConfigs(configs);
      inputRefs.current = configs.map((c) => ({ ...c }));
      setActiveTab(0);
      setFocusedField(0);
      cursorRef.current = configs[0]?.name.length || 0;
      setStep("configure");
    },
    []
  );

  const handleProviderCancel = useCallback(() => {
    if (onCancel) onCancel();
  }, [onCancel]);

  const saveConfig = useCallback(async () => {
    const configs = inputRefs.current;

    // Validate non-empty
    for (const c of configs) {
      if (!c.name.trim()) {
        setError(`Name cannot be empty for ${c.id}`);
        return;
      }
      if (!c.tag.trim()) {
        setError(`Tag cannot be empty for ${c.id}`);
        return;
      }
      if (!c.model.trim()) {
        setError(`Model cannot be empty for ${c.id}`);
        return;
      }
    }

    // Validate unique names
    const names = new Set<string>();
    for (const c of configs) {
      const lower = c.name.trim().toLowerCase();
      if (names.has(lower)) {
        setError(`Duplicate agent name: ${c.name}`);
        return;
      }
      names.add(lower);
    }

    const overrides: AgentOverride[] = configs.map((c) => ({
      id: c.id,
      name: c.name.trim(),
      tag: c.tag.trim(),
      model: c.model.trim(),
    }));

    try {
      await writeWizardConfig(selectedIds, overrides);
      setStep("done");
    } catch (err: any) {
      setError(`Failed to save: ${err.message}`);
    }
  }, [selectedIds]);

  // Configure step keyboard handling
  useKeyboard((key) => {
    if (step !== "configure") {
      // Done step: any key to continue
      if (step === "done") {
        if (key.name === "enter" || key.name === "return" || key.name === "space") {
          onComplete();
        }
        return;
      }
      return;
    }

    const configs = inputRefs.current;
    if (configs.length === 0) return;

    const current = configs[activeTab];
    const fields = [current.name, current.tag, current.model];
    const fieldValue = fields[focusedField];
    const cursor = cursorRef.current;

    const updateField = (value: string, newCursor: number) => {
      if (focusedField === 0) current.name = value;
      else if (focusedField === 1) current.tag = value;
      else current.model = value;
      cursorRef.current = newCursor;
      setError("");
      forceRender((n) => n + 1);
    };

    // Tab bar navigation: [ and ] or Left/Right when not in a field
    if (key.sequence === "[" || key.sequence === "]") {
      const dir = key.sequence === "[" ? -1 : 1;
      const next = (activeTab + dir + configs.length) % configs.length;
      setActiveTab(next);
      cursorRef.current = getFieldValue(configs[next], focusedField).length;
      forceRender((n) => n + 1);
      return;
    }

    // Tab: cycle fields (name -> tag -> model -> name)
    if (key.name === "tab") {
      const nextField = key.shift
        ? (focusedField - 1 + 3) % 3
        : (focusedField + 1) % 3;
      setFocusedField(nextField);
      cursorRef.current = getFieldValue(current, nextField).length;
      forceRender((n) => n + 1);
      return;
    }

    // Enter: save
    if (key.name === "enter" || key.name === "return") {
      saveConfig();
      return;
    }

    // Escape: cancel if available
    if (key.name === "escape" && onCancel) {
      onCancel();
      return;
    }

    // Text editing (same pattern as InputLine)
    if (key.name === "backspace") {
      if (cursor > 0) {
        updateField(fieldValue.slice(0, cursor - 1) + fieldValue.slice(cursor), cursor - 1);
      }
      return;
    }

    if (key.name === "delete") {
      if (cursor < fieldValue.length) {
        updateField(fieldValue.slice(0, cursor) + fieldValue.slice(cursor + 1), cursor);
      }
      return;
    }

    if (key.name === "left") {
      cursorRef.current = Math.max(0, cursor - 1);
      forceRender((n) => n + 1);
      return;
    }

    if (key.name === "right") {
      cursorRef.current = Math.min(fieldValue.length, cursor + 1);
      forceRender((n) => n + 1);
      return;
    }

    if (key.name === "home" || (key.ctrl && key.name === "a")) {
      cursorRef.current = 0;
      forceRender((n) => n + 1);
      return;
    }

    if (key.name === "end" || (key.ctrl && key.name === "e")) {
      cursorRef.current = fieldValue.length;
      forceRender((n) => n + 1);
      return;
    }

    if (key.ctrl && key.name === "u") {
      updateField("", 0);
      return;
    }

    // Skip non-printable
    if (key.ctrl || key.name === "up" || key.name === "down" ||
        key.name === "pageup" || key.name === "pagedown" ||
        key.name === "space") {
      return;
    }

    // Normal character
    const ch = key.sequence;
    if (ch && ch.length > 0 && !ch.startsWith("\x1b")) {
      updateField(
        fieldValue.slice(0, cursor) + ch + fieldValue.slice(cursor),
        cursor + ch.length
      );
    }
  });

  // ── RENDER ──

  const title = isFirstRun ? "Welcome to llm-party" : "Configure Agents";

  // Step: detect
  if (step === "detect") {
    return (
      <box flexDirection="column" paddingX={2} paddingY={1}>
        <text fg="#00BFFF"><strong>{title}</strong></text>
        <text fg="#00FF88" marginTop={1}>
          {spinner} Scanning for installed CLIs...
        </text>
      </box>
    );
  }

  // Step: providers
  if (step === "providers") {
    return (
      <box flexDirection="column" paddingX={2} paddingY={1}>
        <text fg="#00BFFF"><strong>{title}</strong></text>
        <text fg="#888888" marginTop={1}>
          Select your agents (Space to toggle, Enter to confirm)
        </text>
        <box marginTop={1}>
          <MultiSelect
            items={multiSelectItems}
            onConfirm={handleProviderConfirm}
            onCancel={isFirstRun ? undefined : handleProviderCancel}
          />
        </box>
      </box>
    );
  }

  // Step: configure
  if (step === "configure") {
    const configs = inputRefs.current;
    const current = configs[activeTab];

    return (
      <box flexDirection="column" paddingX={2} paddingY={1}>
        <text fg="#00BFFF"><strong>{title}</strong></text>

        {!isFirstRun && (
          <text fg="#FF8800" marginTop={1}>
            Changes will take effect on next session
          </text>
        )}

        {/* Tab bar */}
        <box flexDirection="row" marginTop={1}>
          {configs.map((c, i) => {
            const isActive = i === activeTab;
            return (
              <text
                key={c.id}
                fg={isActive ? "#00FF88" : "#888888"}
                bg={isActive ? "#1a1a2e" : undefined}
              >
                {" "}{c.name || c.id}{" "}
              </text>
            );
          })}
        </box>
        <text fg="#555555">
          {"─".repeat(40)}
        </text>

        {/* Help text */}
        <text fg="#555555">
          [ ] switch tabs  |  Tab move fields  |  Enter save
        </text>

        {/* Fields for active tab */}
        <box flexDirection="column" marginTop={1}>
          {renderField("Name ", current.name, focusedField === 0)}
          {renderField("Tag  ", current.tag, focusedField === 1)}
          {renderField("Model", current.model, focusedField === 2)}
        </box>

        {error && (
          <text fg="#FF4444" marginTop={1}>{error}</text>
        )}
      </box>
    );
  }

  // Step: done
  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      <text fg="#00FF88"><strong>Config saved!</strong></text>
      <text fg="#888888" marginTop={1}>
        Written to ~/.llm-party/config.json
      </text>
      <text fg="#555555" marginTop={1}>
        You can always edit this file to add prompts, env vars, or tweak settings.
      </text>
      <text fg="#00BFFF" marginTop={2}>
        Press Enter to continue
      </text>
    </box>
  );

  function renderField(label: string, value: string, isFocused: boolean): JSX.Element {
    const cursor = cursorRef.current;
    const labelColor = isFocused ? "#00FF88" : "#888888";

    if (!isFocused) {
      return (
        <text>
          <span fg={labelColor}>{label}: </span>
          <span fg="#FFFFFF">{value}</span>
        </text>
      );
    }

    const before = value.slice(0, cursor);
    const cursorChar = cursor < value.length ? value[cursor] : " ";
    const after = cursor < value.length ? value.slice(cursor + 1) : "";

    return (
      <text>
        <span fg={labelColor}>{label}: </span>
        {before}
        <span bg="#FFFFFF" fg="#000000">{cursorChar}</span>
        {after}
      </text>
    );
  }
}

function getFieldValue(config: AgentConfig, field: number): string {
  if (field === 0) return config.name;
  if (field === 1) return config.tag;
  return config.model;
}
