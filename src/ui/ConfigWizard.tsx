import { useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { userInfo } from "node:os";
import { PROVIDERS } from "../config/defaults.js";
import { detectProviders, type DetectionResult } from "../config/detector.js";
import { writeWizardConfig, type AgentOverride } from "../config/writer.js";
import { MultiSelect, type MultiSelectItem } from "./MultiSelect.js";
import { toTag } from "../utils.js";
import type { AppConfig } from "../types.js";

type WizardStep = "detect" | "providers" | "configure" | "done";

const TAG_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface ConfigWizardProps {
  isFirstRun: boolean;
  onComplete: () => void;
  onCancel?: () => void;
  existingConfig?: AppConfig;
}

interface AgentConfig {
  id: string;
  name: string;
  tag: string;
  model: string;
}

interface HumanConfig {
  name: string;
  tag: string;
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

export function ConfigWizard({ isFirstRun, onComplete, onCancel, existingConfig }: ConfigWizardProps) {
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
  const humanRef = useRef<HumanConfig>({
    name: existingConfig?.humanName || userInfo().username || "USER",
    tag: existingConfig?.humanTag || toTag(existingConfig?.humanName || userInfo().username || "USER"),
  });
  const cursorRef = useRef(0);

  const spinner = useSpinner();

  // Run detection on mount
  useEffect(() => {
    detectProviders().then((results) => {
      setDetection(results);
      setStep("providers");
    });
  }, []);

  // Build a lookup of existing agents by provider
  const existingByProvider = new Map(
    (existingConfig?.agents || []).map((a) => [a.provider, a])
  );

  // Pre-select indices of providers that exist in current config
  const initialSelected = existingConfig
    ? PROVIDERS.map((p, i) => existingByProvider.has(p.id) ? i : -1).filter((i) => i >= 0)
    : undefined;

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
        const existing = existingByProvider.get(id);
        return {
          id: def.id,
          name: existing?.name || def.displayName,
          tag: existing?.tag || def.defaultTag,
          model: existing?.model || def.defaultModel,
        };
      });

      setAgentConfigs(configs);
      inputRefs.current = configs.map((c) => ({ ...c }));
      setActiveTab(0);
      setFocusedField(0);
      cursorRef.current = configs[0]?.name.length || 0;
      setStep("configure");
    },
    [existingByProvider]
  );

  const handleProviderCancel = useCallback(() => {
    if (onCancel) onCancel();
  }, [onCancel]);

  // Tab 0 = "You", tabs 1+ = agents
  // "You" tab has 2 fields (name, tag), agent tabs have 3 (name, tag, model)
  const isYouTab = activeTab === 0;
  const agentTabIndex = activeTab - 1;
  const totalTabs = (inputRefs.current?.length || 0) + 1;
  const maxFieldIndex = isYouTab ? 1 : 2; // 0-indexed: You=0,1  Agent=0,1,2

  const saveConfig = useCallback(async () => {
    const configs = inputRefs.current;
    const human = humanRef.current;

    // Validate human
    if (!human.name.trim()) {
      setError("Your name cannot be empty");
      return;
    }
    if (!human.tag.trim()) {
      setError("Your tag cannot be empty");
      return;
    }
    if (!TAG_PATTERN.test(human.tag.trim())) {
      setError("Your tag can only contain letters, numbers, hyphens, underscores");
      return;
    }

    // Validate agents
    for (const c of configs) {
      if (!c.name.trim()) {
        setError(`Name cannot be empty for ${c.id}`);
        return;
      }
      if (!c.tag.trim()) {
        setError(`Tag cannot be empty for ${c.id}`);
        return;
      }
      if (!TAG_PATTERN.test(c.tag.trim())) {
        setError(`Tag for ${c.name} can only contain letters, numbers, hyphens, underscores`);
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

    // Merge human config into existing
    const mergedExisting: AppConfig = {
      ...(existingConfig || {}),
      humanName: human.name.trim(),
      humanTag: human.tag.trim(),
      agents: existingConfig?.agents || [],
    };

    try {
      await writeWizardConfig(selectedIds, overrides, mergedExisting);
      setStep("done");
    } catch (err: any) {
      setError(`Failed to save: ${err.message}`);
    }
  }, [selectedIds, existingConfig]);

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
    const human = humanRef.current;

    // Get current field value based on active tab
    let fieldValue: string;
    if (isYouTab) {
      fieldValue = focusedField === 0 ? human.name : human.tag;
    } else {
      const current = configs[agentTabIndex];
      if (!current) return;
      fieldValue = [current.name, current.tag, current.model][focusedField];
    }
    const cursor = cursorRef.current;

    const updateField = (value: string, newCursor: number) => {
      if (isYouTab) {
        if (focusedField === 0) human.name = value;
        else human.tag = value;
      } else {
        const current = configs[agentTabIndex];
        if (focusedField === 0) current.name = value;
        else if (focusedField === 1) current.tag = value;
        else current.model = value;
      }
      cursorRef.current = newCursor;
      setError("");
      forceRender((n) => n + 1);
    };

    // Tab bar navigation: [ and ]
    if (key.sequence === "[" || key.sequence === "]") {
      const dir = key.sequence === "[" ? -1 : 1;
      const next = (activeTab + dir + totalTabs) % totalTabs;
      setActiveTab(next);
      // Clamp focused field to max for the new tab
      const newMax = next === 0 ? 1 : 2;
      const newField = Math.min(focusedField, newMax);
      setFocusedField(newField);
      // Get field value for new tab
      let newVal: string;
      if (next === 0) {
        newVal = newField === 0 ? human.name : human.tag;
      } else {
        newVal = getFieldValue(configs[next - 1], newField);
      }
      cursorRef.current = newVal.length;
      forceRender((n) => n + 1);
      return;
    }

    // Tab: cycle fields
    if (key.name === "tab") {
      const fieldCount = maxFieldIndex + 1;
      const nextField = key.shift
        ? (focusedField - 1 + fieldCount) % fieldCount
        : (focusedField + 1) % fieldCount;
      setFocusedField(nextField);
      let newVal: string;
      if (isYouTab) {
        newVal = nextField === 0 ? human.name : human.tag;
      } else {
        newVal = getFieldValue(configs[agentTabIndex], nextField);
      }
      cursorRef.current = newVal.length;
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
            initialSelected={initialSelected}
          />
        </box>
      </box>
    );
  }

  // Step: configure
  if (step === "configure") {
    const configs = inputRefs.current;
    const human = humanRef.current;

    // Build tab labels: "You" + agent names
    const tabLabels = ["You", ...configs.map((c) => c.name || c.id)];

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
          {tabLabels.map((label, i) => {
            const isActive = i === activeTab;
            return (
              <text
                key={label + i}
                fg={isActive ? "#00FF88" : "#888888"}
                bg={isActive ? "#1a1a2e" : undefined}
              >
                {" "}{label}{" "}
              </text>
            );
          })}
        </box>
        <text fg="#555555">
          {"─".repeat(40)}
        </text>

        {/* Help text */}
        <text fg="#555555">
          [ ] switch tabs  |  Tab move fields  |  Enter save & close
        </text>

        {/* Fields for active tab */}
        <box flexDirection="column" marginTop={1}>
          {isYouTab ? (
            <>
              {renderField("Name", human.name, focusedField === 0)}
              {renderField("Tag ", human.tag, focusedField === 1)}
            </>
          ) : (
            <>
              {renderField("Name ", configs[agentTabIndex].name, focusedField === 0)}
              {renderField("Tag  ", configs[agentTabIndex].tag, focusedField === 1)}
              {renderField("Model", configs[agentTabIndex].model, focusedField === 2)}
            </>
          )}
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

  function renderField(label: string, value: string, isFocused: boolean) {
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
