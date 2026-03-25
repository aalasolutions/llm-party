import { useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { userInfo } from "node:os";
import { PROVIDERS } from "../config/defaults.js";
import { detectProviders, type DetectionResult } from "../config/detector.js";
import { writeWizardConfig, type AgentOverride } from "../config/writer.js";
import { MultiSelect, type MultiSelectItem } from "./MultiSelect.js";
import { toTag } from "../utils.js";
import { SPINNER_FRAMES } from "./constants.js";
import { COLORS, PARTY_COLORS } from "./theme.js";
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
// Use shared spinner frames from constants

function useSpinner(): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(interval);
  }, []);
  return SPINNER_FRAMES[frame];
}

// Sweep title: disco lights animate around a centered title
const SWEEP_CHARS = ["░", "▒", "▓", "█", "▓", "▒", "░"];
// PARTY_COLORS imported from theme.ts
const BAR_WIDTH = 6; // chars per side

function SweepBar({ title }: { title: string }) {
  const glow = SWEEP_CHARS.length;
  const totalWidth = BAR_WIDTH * 2 + title.length + 2; // +2 for spaces around title
  const [pos, setPos] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setPos((p) => (p + 1) % (BAR_WIDTH + glow)), 50);
    return () => clearInterval(interval);
  }, []);

  function buildSide(reverse: boolean) {
    const spans: Array<{ char: string; color: string }> = [];
    for (let i = 0; i < BAR_WIDTH; i++) {
      const idx = reverse ? BAR_WIDTH - 1 - i : i;
      const dist = idx - pos;
      if (dist >= 0 && dist < glow) {
        const colorIdx = Math.floor((pos + idx) / 2) % PARTY_COLORS.length;
        const intensity = 1 - Math.abs(dist - 3) / 3;
        spans.push({
          char: SWEEP_CHARS[dist],
          color: intensity > 0.3 ? PARTY_COLORS[colorIdx] : COLORS.borderStrong,
        });
      } else {
        spans.push({ char: "░", color: COLORS.bgSweepDim });
      }
    }
    return spans;
  }

  const left = buildSide(false);
  const right = buildSide(true);

  return (
    <text>
      {left.map((s, i) => (
        <span key={"l" + i} fg={s.color}>{s.char}</span>
      ))}
      <span fg={COLORS.textPrimary}><strong>{" "}{title}{" "}</strong></span>
      {right.map((s, i) => (
        <span key={"r" + i} fg={s.color}>{s.char}</span>
      ))}
    </text>
  );
}

// Disco border accent: color-cycling side decorations
function useDiscoColor(): string {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setIdx((i) => (i + 1) % PARTY_COLORS.length), 800);
    return () => clearInterval(interval);
  }, []);
  return PARTY_COLORS[idx];
}

export function ConfigWizard({ isFirstRun, onComplete, onCancel, existingConfig }: ConfigWizardProps) {
  const [step, setStep] = useState<WizardStep>("detect");
  const [detection, setDetection] = useState<DetectionResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [, setAgentConfigs] = useState<AgentConfig[]>([]);
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
    detectProviders()
      .then((results) => {
        setDetection(results);
        setStep("providers");
      })
      .catch(() => {
        setDetection([]);
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
    // Ctrl+C: exit app from any step (triggers SIGINT handler in index.ts which cleans up renderer)
    if (key.ctrl && key.name === "c") {
      process.kill(process.pid, "SIGINT");
      return;
    }

    if (step !== "configure") {
      // Detect step: consume all keys, keyboard disabled during loading
      if (step === "detect") {
        return;
      }
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

    // Escape: back to provider selection (or cancel if at providers step)
    if (key.name === "escape") {
      setStep("providers");
      setFocusedField(0);
      setActiveTab(0);
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
        key.name === "pageup" || key.name === "pagedown") {
      return;
    }

    // Space: allowed in name and model (fields 0, 2), blocked in tag (field 1)
    if (key.name === "space" || key.sequence === " ") {
      if (focusedField !== 1) {
        updateField(fieldValue.slice(0, cursor) + " " + fieldValue.slice(cursor), cursor + 1);
      }
      return;
    }

    // Normal character: alphanumeric + space for names, TAG_PATTERN for tags
    const ch = key.sequence;
    if (ch && ch.length > 0 && !ch.startsWith("\x1b")) {
      // Block quotes and backticks in all fields
      if (ch === "'" || ch === '"' || ch === "`") return;
      // Tags: only alphanumeric, hyphens, underscores
      if (focusedField === 1 && !TAG_PATTERN.test(ch)) return;
      updateField(
        fieldValue.slice(0, cursor) + ch + fieldValue.slice(cursor),
        cursor + ch.length
      );
    }
  });

  // ── RENDER ──

  const title = isFirstRun ? "Welcome to llm-party" : "Configure Agents";
  const subtitle = isFirstRun
    ? "Bring your models. We'll bring the party."
    : "Changes will take effect on next session";
  const subtitleColor = isFirstRun ? COLORS.textDim : COLORS.warning;

  function Subtitle() {
    return <text alignSelf="center" fg={subtitleColor}>{subtitle}</text>;
  }

  const discoColor = useDiscoColor();

  // Step: detect
  if (step === "detect") {
    return (
      <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
        <box border borderStyle="double" borderColor={discoColor} paddingX={4} paddingY={1} backgroundColor={COLORS.bgPanel}>
          <box flexDirection="column" alignItems="center">
            <SweepBar title="llm-party" />
            <text fg={COLORS.success} marginTop={1}>
              {spinner} Scanning for installed CLIs...
            </text>
          </box>
        </box>
      </box>
    );
  }

  // Step: providers
  if (step === "providers") {
    return (
      <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
        <box
          border
          borderStyle="double"
          borderColor={discoColor}
          paddingX={3}
          paddingY={1}
          backgroundColor={COLORS.bgPanel}
          minWidth={50}
        >
          <box flexDirection="column">
            <box alignSelf="center">
              <SweepBar title={title} />
            </box>
            <Subtitle />

            <text alignSelf="center" fg={COLORS.textSubtle} marginTop={1}>{"═".repeat(44)}</text>

            <text marginTop={1}>
              <span fg={COLORS.textSecondary}>Select your agents  </span>
              <span fg={COLORS.success}>Space</span>
              <span fg={COLORS.textFaint}>{" toggle  "}</span>
              <span fg={COLORS.success}>Enter</span>
              <span fg={COLORS.textFaint}>{" confirm"}</span>
              {!isFirstRun && (
                <>
                  <span fg={COLORS.textFaint}>{"  "}</span>
                  <span fg={COLORS.error}>Esc</span>
                  <span fg={COLORS.textFaint}>{" cancel"}</span>
                </>
              )}
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
        </box>
      </box>
    );
  }

  // Step: configure
  if (step === "configure") {
    const configs = inputRefs.current;
    const human = humanRef.current;

    // Build tab labels: "You" + agent names
    const tabLabels = ["You", ...selectedIds.map((id) => {
      const def = PROVIDERS.find((p) => p.id === id);
      return def?.displayName || id;
    })];

    return (
      <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
        <box
          border
          borderStyle="double"
          borderColor={discoColor}
          paddingX={3}
          paddingY={1}
          backgroundColor={COLORS.bgPanel}
          minWidth={54}
        >
          <box flexDirection="column">
            <box alignSelf="center">
              <SweepBar title={title} />
            </box>

            {!isFirstRun && <Subtitle />}

            {/* Tab bar with visual brackets */}
            <box flexDirection="row" marginTop={1} alignSelf="center">
              {tabLabels.map((label, i) => {
                const isActive = i === activeTab;
                return (
                  <text
                    key={label + i}
                    fg={isActive ? COLORS.success : COLORS.textSubtle}
                    bg={isActive ? COLORS.bgActiveTab : undefined}
                  >
                    <strong>{" "}{label}{" "}</strong>
                  </text>
                );
              })}
            </box>

            <text alignSelf="center" fg={COLORS.borderStrong}>{"━".repeat(48)}</text>

            {/* Fields panel */}
            <box
              border
              borderStyle="rounded"
              borderColor={isYouTab ? COLORS.agent : COLORS.success}
              paddingX={2}
              paddingY={1}
              marginTop={1}
              backgroundColor={COLORS.bgContent}
            >
              <box flexDirection="column">
                {isYouTab ? (
                  <>
                    <text fg={COLORS.agent} marginBottom={1}><strong>Your Identity</strong></text>
                    {renderField("Name", human.name, focusedField === 0)}
                    {renderField("Tag ", human.tag, focusedField === 1)}
                  </>
                ) : (
                  <>
                    <text fg={COLORS.success} marginBottom={1}>
                      <strong>{tabLabels[activeTab]} Configuration</strong>
                    </text>
                    {renderField("Name ", configs[agentTabIndex].name, focusedField === 0)}
                    {renderField("Tag  ", configs[agentTabIndex].tag, focusedField === 1)}
                    {renderField("Model", configs[agentTabIndex].model, focusedField === 2)}
                  </>
                )}
              </box>
            </box>

            {/* Shortcut bar */}
            <box flexDirection="row" marginTop={1} justifyContent="space-between">
              <text>
                <span fg={COLORS.textFaint}>{"◂ "}</span>
                <span fg={COLORS.success}>{"["}</span>
                <span fg={COLORS.textFaint}>{" prev  "}</span>
                <span fg={COLORS.success}>{"]"}</span>
                <span fg={COLORS.textFaint}>{" next "}</span>
                <span fg={COLORS.textFaint}>{"▸  "}</span>
                <span fg={COLORS.success}>Tab</span>
                <span fg={COLORS.textFaint}>{" fields  "}</span>
                <span fg={COLORS.success}>Enter</span>
                <span fg={COLORS.textFaint}>{" save & close"}</span>
                <span fg={COLORS.textFaint}>{"  "}</span>
                <span fg={COLORS.warning}>Esc</span>
                <span fg={COLORS.textFaint}>{" back"}</span>
              </text>
            </box>

            {error && (
              <box border borderStyle="rounded" borderColor={COLORS.error} paddingX={1} marginTop={1} backgroundColor={COLORS.bgError}>
                <text fg={COLORS.error}>{error}</text>
              </box>
            )}
          </box>
        </box>
      </box>
    );
  }

  // Step: done
  return (
    <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
      <box
        border
        borderStyle="double"
        borderColor={discoColor}
        paddingX={4}
        paddingY={2}
        backgroundColor={COLORS.bgPanel}
      >
        <box flexDirection="column" alignItems="center">
          <SweepBar title="Config Saved" />
          <text fg={COLORS.textSubtle} marginTop={1}>{"─".repeat(36)}</text>
          <text fg={COLORS.textMuted} marginTop={1}>
            Written to ~/.llm-party/config.json
          </text>
          <text fg={COLORS.textSubtle} marginTop={1}>
            Edit this file anytime to add prompts,
          </text>
          <text fg={COLORS.textSubtle}>
            env vars, or tweak settings.
          </text>
          <text fg={COLORS.textSubtle} marginTop={1}>{"─".repeat(36)}</text>
          <text fg={COLORS.primary} marginTop={1}>
            Press <span fg={COLORS.success}><strong>Enter</strong></span> to continue
          </text>
        </box>
      </box>
    </box>
  );

  function renderField(label: string, value: string, isFocused: boolean) {
    const cursor = cursorRef.current;
    const labelColor = isFocused ? COLORS.primary : COLORS.textDim;
    const indicator = isFocused ? "▸" : " ";
    const indicatorColor = COLORS.primary;
    const valueColor = isFocused ? COLORS.textPrimary : COLORS.textSecondary;

    if (!isFocused) {
      return (
        <text>
          <span fg={COLORS.borderStrong}>{indicator} </span>
          <span fg={labelColor}>{label}: </span>
          <span fg={valueColor}>{value}</span>
        </text>
      );
    }

    const before = value.slice(0, cursor);
    const cursorChar = cursor < value.length ? value[cursor] : " ";
    const after = cursor < value.length ? value.slice(cursor + 1) : "";

    return (
      <text>
        <span fg={indicatorColor}>{indicator} </span>
        <span fg={labelColor}>{label}: </span>
        {before}
        <span bg={COLORS.textPrimary} fg="#000000">{cursorChar}</span>
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
