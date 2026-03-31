import { createSignal, createEffect, onCleanup, Show, For } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { userInfo } from "node:os";
import { PROVIDERS } from "../config/defaults.js";
import { detectProviders, type DetectionResult } from "../config/detector.js";
import { writeConfig } from "../config/writer.js";
import { MultiSelect, type MultiSelectItem } from "./MultiSelect.js";
import { toTag } from "../utils.js";
import { SPINNER_FRAMES } from "./constants.js";
import { COLORS, PARTY_COLORS } from "./theme.js";
import type { AppConfig, PersonaConfig } from "../types.js";

type WizardStep = "detect" | "providers" | "configure" | "done";

const TAG_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface ConfigWizardProps {
  isFirstRun: boolean;
  onComplete: () => void;
  onCancel?: () => void;
  existingConfig?: AppConfig;
}

// Internal agent config for the wizard. Index = identity.
interface AgentEntry {
  name: string;
  tag: string;
  model: string;
  provider: PersonaConfig["provider"];
  active: boolean;
  authUrl: string;
  authToken: string;
  cli: string;
  // Preserve fields the wizard doesn't edit
  prompts?: string[];
  preloadSkills?: string[];
  executablePath?: string;
  timeout?: number;
  extraEnv?: Record<string, string>;
}

interface SettingsData {
  name: string;
  tag: string;
  maxHops: string;
  timeout: string;
}

function useSpinner(): () => string {
  const [frame, setFrame] = createSignal(0);
  createEffect(() => {
    const interval = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    onCleanup(() => clearInterval(interval));
  });
  return () => SPINNER_FRAMES[frame()];
}

const SWEEP_CHARS = ["░", "▒", "▓", "█", "▓", "▒", "░"];
const BAR_WIDTH = 6;

function SweepBar(props: { title: string }) {
  const glow = SWEEP_CHARS.length;
  const [pos, setPos] = createSignal(0);
  createEffect(() => {
    const interval = setInterval(() => setPos((p) => (p + 1) % (BAR_WIDTH + glow)), 50);
    onCleanup(() => clearInterval(interval));
  });

  function buildSide(reverse: boolean) {
    const spans: Array<{ char: string; color: string }> = [];
    for (let i = 0; i < BAR_WIDTH; i++) {
      const idx = reverse ? BAR_WIDTH - 1 - i : i;
      const dist = idx - pos();
      if (dist >= 0 && dist < glow) {
        const colorIdx = Math.floor((pos() + idx) / 2) % PARTY_COLORS.length;
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

  const left = () => buildSide(false);
  const right = () => buildSide(true);

  return (
    <text>
      <For each={left()}>{(s) => (
        <span style={{ fg: s.color }}>{s.char}</span>
      )}</For>
      <span style={{ fg: COLORS.textPrimary }}><strong>{" "}{props.title}{" "}</strong></span>
      <For each={right()}>{(s) => (
        <span style={{ fg: s.color }}>{s.char}</span>
      )}</For>
    </text>
  );
}

function useDiscoColor(): () => string {
  const [idx, setIdx] = createSignal(0);
  createEffect(() => {
    const interval = setInterval(() => setIdx((i) => (i + 1) % PARTY_COLORS.length), 800);
    onCleanup(() => clearInterval(interval));
  });
  return () => PARTY_COLORS[idx()];
}

// Convert existing PersonaConfig to wizard AgentEntry
function personaToEntry(agent: PersonaConfig): AgentEntry {
  const env = agent.env ?? {};
  return {
    name: agent.name,
    tag: agent.tag,
    model: agent.model,
    provider: agent.provider,
    active: agent.active !== false,
    authUrl: env.AUTH_URL ?? "",
    authToken: env.AUTH_TOKEN ?? "",
    cli: agent.cli ?? "claude",
    prompts: agent.prompts,
    preloadSkills: agent.preloadSkills,
    executablePath: agent.executablePath,
    timeout: agent.timeout,
    extraEnv: extractExtraEnv(env),
  };
}

// Get env vars that aren't AUTH_URL or AUTH_TOKEN (preserve user-added env)
function extractExtraEnv(env: Record<string, string>): Record<string, string> | undefined {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k !== "AUTH_URL" && k !== "AUTH_TOKEN") {
      extra[k] = v;
    }
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

// Convert wizard AgentEntry back to PersonaConfig for saving
function entryToPersona(entry: AgentEntry): PersonaConfig {
  const config: PersonaConfig = {
    name: entry.name.trim(),
    tag: entry.tag.trim(),
    provider: entry.provider,
    model: entry.model.trim(),
    active: entry.active,
  };

  if (entry.provider === "custom") {
    config.cli = (entry.cli || "claude") as PersonaConfig["cli"];
    const env: Record<string, string> = {};
    if (entry.authUrl) env.AUTH_URL = entry.authUrl;
    if (entry.authToken) env.AUTH_TOKEN = entry.authToken;
    if (entry.extraEnv) Object.assign(env, entry.extraEnv);
    if (Object.keys(env).length > 0) config.env = env;
  }

  if (entry.prompts) config.prompts = entry.prompts;
  if (entry.preloadSkills) config.preloadSkills = entry.preloadSkills;
  if (entry.executablePath) config.executablePath = entry.executablePath;
  if (entry.timeout) config.timeout = entry.timeout;

  return config;
}

export function ConfigWizard(props: ConfigWizardProps) {
  const [step, setStep] = createSignal<WizardStep>("detect");
  const [detection, setDetection] = createSignal<DetectionResult[]>([]);
  const [activeTab, setActiveTab] = createSignal(0);
  const [focusedField, setFocusedField] = createSignal(0);
  const [error, setError] = createSignal("");
  const [tick, setTick] = createSignal(0);
  const [customItems, setCustomItems] = createSignal<AgentEntry[]>([]);

  // Mutable data for the configure step
  let agentEntries: AgentEntry[] = [];
  let settingsData: SettingsData = {
    name: props.existingConfig?.humanName || userInfo().username || "USER",
    tag: props.existingConfig?.humanTag || toTag(props.existingConfig?.humanName || userInfo().username || "USER"),
    maxHops: String(props.existingConfig?.maxAutoHops ?? 15),
    timeout: String(props.existingConfig?.timeout ?? 600),
  };
  let cursorPos = 0;

  const spinner = useSpinner();
  const tuiRenderer = useRenderer();

  // Handle paste events for configure step fields
  createEffect(() => {
    const handlePaste = (event: any) => {
      if (step() !== "configure") return;
      const text = new TextDecoder().decode(event.bytes);
      if (!text) return;
      const cleaned = text.replace(/\n/g, "");
      if (!cleaned) return;
      const fieldValue = getCurrentFieldValue();
      const cursor = cursorPos;
      updateField(fieldValue.slice(0, cursor) + cleaned + fieldValue.slice(cursor), cursor + cleaned.length);
    };
    (tuiRenderer as any).keyInput.on("paste", handlePaste);
    onCleanup(() => { (tuiRenderer as any).keyInput.off("paste", handlePaste); });
  });

  // Load existing custom agents from config
  createEffect(() => {
    const existing = props.existingConfig?.agents ?? [];
    const customs = existing.filter((a) => a.provider === "custom").map(personaToEntry);
    setCustomItems(customs);
  });

  // Run detection on mount
  createEffect(() => {
    detectProviders()
      .then((results) => {
        setDetection(results);
        setStep("providers");
      })
      .catch(() => {
        setDetection([]);
        setStep("providers");
      });
  });

  // Existing native agents by provider for pre-filling
  const existingNative = () => {
    const map = new Map<string, PersonaConfig>();
    for (const a of props.existingConfig?.agents ?? []) {
      if (a.provider !== "custom") map.set(a.provider, a);
    }
    return map;
  };

  // Build MultiSelect items: native providers + custom separator + custom agents
  const multiSelectItems = (): MultiSelectItem[] => {
    const nativeItems: MultiSelectItem[] = PROVIDERS.map((provider) => {
      const result = detection().find((d) => d.id === provider.id);
      const available = result?.available ?? false;
      return {
        label: provider.displayName,
        description: available ? provider.description : provider.unavailableHint,
        disabled: !available,
      };
    });

    const customs = customItems();
    if (customs.length > 0) {
      nativeItems.push({ label: "── Custom ──", description: "", disabled: true });
    }

    const customEntries: MultiSelectItem[] = customs.map((c) => ({
      label: c.name,
      description: "custom provider",
    }));

    return [...nativeItems, ...customEntries];
  };

  // Initial selection: native by provider match, custom by active state
  const initialSelected = (): number[] | undefined => {
    if (!props.existingConfig) return undefined;
    const indices: number[] = [];
    const nativeMap = existingNative();

    // Native: selected if in existing config and active
    PROVIDERS.forEach((p, i) => {
      const existing = nativeMap.get(p.id);
      if (existing && existing.active !== false) indices.push(i);
    });

    // Custom: offset by PROVIDERS.length + 1 (separator)
    const customs = customItems();
    if (customs.length > 0) {
      const offset = PROVIDERS.length + 1; // +1 for separator
      customs.forEach((c, i) => {
        if (c.active) indices.push(offset + i);
      });
    }

    return indices.length > 0 ? indices : undefined;
  };

  const handleAddCustom = (name: string) => {
    const entry: AgentEntry = {
      name,
      tag: toTag(name),
      model: "",
      provider: "custom",
      active: true,
      authUrl: "",
      authToken: "",
      cli: "claude",
    };
    setCustomItems((prev) => [...prev, entry]);
  };

  const handleProviderConfirm = (selectedIndices: number[]) => {
    const nativeMap = existingNative();
    const customs = customItems();
    const hasCustoms = customs.length > 0;
    const customOffset = PROVIDERS.length + (hasCustoms ? 1 : 0); // +1 for separator

    const entries: AgentEntry[] = [];

    // Process all providers (native + custom), marking active/inactive
    for (let i = 0; i < PROVIDERS.length; i++) {
      const def = PROVIDERS[i];
      const isSelected = selectedIndices.includes(i);
      const existing = nativeMap.get(def.id);

      if (isSelected || existing) {
        entries.push({
          name: existing?.name || def.displayName,
          tag: existing?.tag || def.defaultTag,
          model: existing?.model || def.defaultModel,
          provider: def.id as PersonaConfig["provider"],
          active: isSelected,
          authUrl: "",
          authToken: "",
          cli: "claude",
          prompts: existing?.prompts,
          preloadSkills: existing?.preloadSkills,
          executablePath: existing?.executablePath,
          timeout: existing?.timeout,
        });
      }
    }

    // Process custom agents
    for (let i = 0; i < customs.length; i++) {
      const isSelected = selectedIndices.includes(customOffset + i);
      entries.push({ ...customs[i], active: isSelected });
    }

    agentEntries = entries;
    setActiveTab(0);
    setFocusedField(0);
    cursorPos = settingsData.name.length;
    setStep("configure");
  };

  const handleProviderCancel = () => {
    if (props.onCancel) props.onCancel();
  };

  // Tab 0 = "Settings", tabs 1+ = active agents only
  const activeEntries = () => agentEntries.filter((e) => e.active);
  const isSettingsTab = () => activeTab() === 0;
  const agentTabIndex = () => activeTab() - 1;
  const totalTabs = () => activeEntries().length + 1;

  const isCustomAgent = () => {
    if (isSettingsTab()) return false;
    const entry = activeEntries()[agentTabIndex()];
    return entry?.provider === "custom";
  };

  // Settings: 4 fields, Native agent: 3 fields, Custom agent: 5 fields
  const maxFieldIndex = () => {
    if (isSettingsTab()) return 3;
    return isCustomAgent() ? 4 : 2;
  };

  const getFieldValueForEntry = (entry: AgentEntry, field: number): string => {
    if (entry.provider === "custom") {
      return [entry.name, entry.tag, entry.model, entry.authUrl, entry.authToken][field];
    }
    return [entry.name, entry.tag, entry.model][field];
  };

  const getSettingsFieldValue = (field: number): string => {
    return [settingsData.name, settingsData.tag, settingsData.maxHops, settingsData.timeout][field];
  };

  const getCurrentFieldValue = (): string => {
    if (isSettingsTab()) return getSettingsFieldValue(focusedField());
    const entry = activeEntries()[agentTabIndex()];
    if (!entry) return "";
    return getFieldValueForEntry(entry, focusedField());
  };

  const updateField = (value: string, newCursor: number) => {
    if (isSettingsTab()) {
      if (focusedField() === 0) settingsData.name = value;
      else if (focusedField() === 1) settingsData.tag = value;
      else if (focusedField() === 2) settingsData.maxHops = value;
      else settingsData.timeout = value;
    } else {
      const entry = activeEntries()[agentTabIndex()];
      if (!entry) return;
      if (entry.provider === "custom") {
        if (focusedField() === 0) entry.name = value;
        else if (focusedField() === 1) entry.tag = value;
        else if (focusedField() === 2) entry.model = value;
        else if (focusedField() === 3) entry.authUrl = value;
        else entry.authToken = value;
      } else {
        if (focusedField() === 0) entry.name = value;
        else if (focusedField() === 1) entry.tag = value;
        else entry.model = value;
      }
    }
    cursorPos = newCursor;
    setError("");
    setTick((n) => n + 1);
  };

  // Tag field index: 1 for both settings and agents
  const isTagField = () => focusedField() === 1;
  // Number-only fields: maxHops (2) and timeout (3) on settings tab
  const isNumberField = () => isSettingsTab() && (focusedField() === 2 || focusedField() === 3);

  const saveConfig = async () => {
    // Validate settings
    if (!settingsData.name.trim()) {
      setError("Name cannot be empty");
      return;
    }
    if (!settingsData.tag.trim()) {
      setError("Tag cannot be empty");
      return;
    }
    if (!TAG_PATTERN.test(settingsData.tag.trim())) {
      setError("Tag can only contain letters, numbers, hyphens, underscores");
      return;
    }

    const maxHops = parseInt(settingsData.maxHops, 10);
    if (isNaN(maxHops) || maxHops < 0) {
      setError("Max Hops must be 0 or a positive number");
      return;
    }

    const timeout = parseInt(settingsData.timeout, 10);
    if (isNaN(timeout) || timeout < 0) {
      setError("Timeout must be 0 or a positive number");
      return;
    }

    // Validate agents
    const tags = new Set<string>();
    tags.add(settingsData.tag.trim().toLowerCase());

    for (const entry of agentEntries) {
      if (!entry.name.trim()) {
        setError(`Name cannot be empty for an agent`);
        return;
      }
      if (!entry.tag.trim()) {
        setError(`Tag cannot be empty for ${entry.name}`);
        return;
      }
      if (!TAG_PATTERN.test(entry.tag.trim())) {
        setError(`Tag for ${entry.name} can only contain letters, numbers, hyphens, underscores`);
        return;
      }
      if (!entry.model.trim()) {
        setError(`Model cannot be empty for ${entry.name}`);
        return;
      }

      const tagLower = entry.tag.trim().toLowerCase();
      if (tags.has(tagLower)) {
        setError(`Duplicate tag: ${entry.tag}`);
        return;
      }
      tags.add(tagLower);

      if (entry.provider === "custom" && entry.active && !entry.authUrl.trim()) {
        setError(`URL is required for ${entry.name}`);
        return;
      }
    }

    // Build final config
    const agents = agentEntries.map(entryToPersona);

    const config: AppConfig = {
      humanName: settingsData.name.trim(),
      humanTag: settingsData.tag.trim(),
      maxAutoHops: maxHops,
      timeout: timeout > 0 ? timeout : undefined,
      reminderInterval: props.existingConfig?.reminderInterval,
      agents,
    };

    if (config.timeout === undefined) delete config.timeout;
    if (config.reminderInterval === undefined) delete config.reminderInterval;

    try {
      await writeConfig(config);
      setStep("done");
    } catch (err: any) {
      setError(`Failed to save: ${err.message}`);
    }
  };

  // Keyboard handling
  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      process.kill(process.pid, "SIGINT");
      return;
    }

    if (step() !== "configure") {
      if (step() === "detect") return;
      if (step() === "done") {
        if (key.name === "enter" || key.name === "return" || key.name === "space") {
          props.onComplete();
        }
        return;
      }
      return;
    }

    const fieldValue = getCurrentFieldValue();
    const cursor = cursorPos;

    // Tab bar navigation: [ and ]
    if (key.sequence === "[" || key.sequence === "]") {
      const dir = key.sequence === "[" ? -1 : 1;
      const next = (activeTab() + dir + totalTabs()) % totalTabs();
      setActiveTab(next);
      const newMax = next === 0 ? 3 : (activeEntries()[next - 1]?.provider === "custom" ? 4 : 2);
      const newField = Math.min(focusedField(), newMax);
      setFocusedField(newField);
      let newVal: string;
      if (next === 0) {
        newVal = getSettingsFieldValue(newField);
      } else {
        newVal = getFieldValueForEntry(activeEntries()[next - 1], newField);
      }
      cursorPos = newVal.length;
      setTick((n) => n + 1);
      return;
    }

    // Tab: cycle fields
    if (key.name === "tab") {
      const fieldCount = maxFieldIndex() + 1;
      const nextField = key.shift
        ? (focusedField() - 1 + fieldCount) % fieldCount
        : (focusedField() + 1) % fieldCount;
      setFocusedField(nextField);
      const newVal = isSettingsTab()
        ? getSettingsFieldValue(nextField)
        : getFieldValueForEntry(activeEntries()[agentTabIndex()], nextField);
      cursorPos = newVal.length;
      setTick((n) => n + 1);
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      saveConfig();
      return;
    }

    if (key.name === "escape") {
      setStep("providers");
      setFocusedField(0);
      setActiveTab(0);
      return;
    }

    // Text editing
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
      cursorPos = Math.max(0, cursor - 1);
      setTick((n) => n + 1);
      return;
    }

    if (key.name === "right") {
      cursorPos = Math.min(fieldValue.length, cursor + 1);
      setTick((n) => n + 1);
      return;
    }

    if (key.name === "home" || (key.ctrl && key.name === "a")) {
      cursorPos = 0;
      setTick((n) => n + 1);
      return;
    }

    if (key.name === "end" || (key.ctrl && key.name === "e")) {
      cursorPos = fieldValue.length;
      setTick((n) => n + 1);
      return;
    }

    if (key.ctrl && key.name === "u") {
      updateField("", 0);
      return;
    }

    if (key.ctrl || key.name === "up" || key.name === "down" ||
        key.name === "pageup" || key.name === "pagedown") {
      return;
    }

    // Space: allowed in name and model, blocked in tag and number fields
    if (key.name === "space" || key.sequence === " ") {
      if (!isTagField() && !isNumberField()) {
        updateField(fieldValue.slice(0, cursor) + " " + fieldValue.slice(cursor), cursor + 1);
      }
      return;
    }

    const ch = key.sequence;
    if (ch && ch.length > 0 && !ch.startsWith("\x1b")) {
      if (ch === "'" || ch === '"' || ch === "`") return;
      if (isTagField() && !TAG_PATTERN.test(ch)) return;
      if (isNumberField() && !/^[0-9]$/.test(ch)) return;
      updateField(
        fieldValue.slice(0, cursor) + ch + fieldValue.slice(cursor),
        cursor + ch.length
      );
    }
  });

  // ── RENDER ──

  const title = () => props.isFirstRun ? "Welcome to llm-party" : "Configure Agents";
  const subtitle = () => props.isFirstRun
    ? "Bring your models. We'll bring the party."
    : "Changes will take effect on next session";
  const subtitleColor = () => props.isFirstRun ? COLORS.textDim : COLORS.warning;

  function Subtitle() {
    return <text alignSelf="center" fg={subtitleColor()}>{subtitle()}</text>;
  }

  const discoColor = useDiscoColor();

  function renderField(label: string, value: string, isFocused: boolean, hint?: string) {
    tick();
    const cursor = cursorPos;
    const labelColor = isFocused ? COLORS.primary : COLORS.textDim;
    const indicator = isFocused ? "▸" : " ";
    const indicatorColor = COLORS.primary;
    const valueColor = isFocused ? COLORS.textPrimary : COLORS.textSecondary;

    if (!isFocused) {
      return (
        <text>
          <span style={{ fg: COLORS.borderStrong }}>{indicator} </span>
          <span style={{ fg: labelColor }}>{label}: </span>
          <span style={{ fg: valueColor }}>{value || (hint ? hint : "")}</span>
        </text>
      );
    }

    const before = value.slice(0, cursor);
    const cursorChar = cursor < value.length ? value[cursor] : " ";
    const after = cursor < value.length ? value.slice(cursor + 1) : "";

    return (
      <text>
        <span style={{ fg: indicatorColor }}>{indicator} </span>
        <span style={{ fg: labelColor }}>{label}: </span>
        {before}
        <span style={{ bg: COLORS.textPrimary, fg: "#000000" }}>{cursorChar}</span>
        {after}
      </text>
    );
  }

  // Mask token display (show asterisks when not focused)
  function renderTokenField(label: string, value: string, isFocused: boolean) {
    if (!isFocused && value.length > 0) {
      const masked = value.length > 4
        ? "*".repeat(value.length - 4) + value.slice(-4)
        : "*".repeat(value.length);
      return renderField(label, masked, false);
    }
    return renderField(label, value, isFocused);
  }

  const DetectStep = () => (
    <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
      <box border borderStyle="double" borderColor={discoColor()} paddingX={4} paddingY={1} backgroundColor={COLORS.bgPanel}>
        <box flexDirection="column" alignItems="center">
          <SweepBar title="llm-party" />
          <text fg={COLORS.success} marginTop={1}>
            {spinner()} Scanning for installed CLIs...
          </text>
        </box>
      </box>
    </box>
  );

  const ProvidersStep = () => (
    <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
      <box
        border
        borderStyle="double"
        borderColor={discoColor()}
        paddingX={3}
        paddingY={1}
        backgroundColor={COLORS.bgPanel}
        minWidth={50}
      >
        <box flexDirection="column">
          <box alignSelf="center">
            <SweepBar title={title()} />
          </box>
          <Subtitle />

          <text alignSelf="center" fg={COLORS.textSubtle} marginTop={1}>{"═".repeat(44)}</text>

          <text marginTop={1}>
            <span style={{ fg: COLORS.textSecondary }}>Select your agents  </span>
            <span style={{ fg: COLORS.success }}>Space</span>
            <span style={{ fg: COLORS.textFaint }}>{" toggle  "}</span>
            <span style={{ fg: COLORS.success }}>Enter</span>
            <span style={{ fg: COLORS.textFaint }}>{" confirm"}</span>
            <Show when={!props.isFirstRun}>
              <span style={{ fg: COLORS.textFaint }}>{"  "}</span>
              <span style={{ fg: COLORS.error }}>Esc</span>
              <span style={{ fg: COLORS.textFaint }}>{" cancel"}</span>
            </Show>
          </text>

          <box marginTop={1}>
            <MultiSelect
              items={multiSelectItems()}
              onConfirm={handleProviderConfirm}
              onCancel={props.isFirstRun ? undefined : handleProviderCancel}
              initialSelected={initialSelected()}
              addCustom={{ onAdd: handleAddCustom }}
            />
          </box>
        </box>
      </box>
    </box>
  );

  const ConfigureStep = () => {
    tick();
    const active = activeEntries();

    const tabLabels = ["Settings", ...active.map((e) => e.name)];

    return (
      <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
        <box
          border
          borderStyle="double"
          borderColor={discoColor()}
          paddingX={3}
          paddingY={1}
          backgroundColor={COLORS.bgPanel}
          minWidth={54}
        >
          <box flexDirection="column">
            <box alignSelf="center">
              <SweepBar title={title()} />
            </box>

            <Show when={!props.isFirstRun}>
              <Subtitle />
            </Show>

            {/* Tab bar */}
            <box flexDirection="row" marginTop={1} alignSelf="center">
              <For each={tabLabels}>{(label, i) => {
                const isActive = () => i() === activeTab();
                return (
                  <text
                    fg={isActive() ? COLORS.success : COLORS.textSubtle}
                    bg={isActive() ? COLORS.bgActiveTab : undefined}
                  >
                    <strong>{" "}{label}{" "}</strong>
                  </text>
                );
              }}</For>
            </box>

            <text alignSelf="center" fg={COLORS.borderStrong}>{"━".repeat(48)}</text>

            {/* Fields panel */}
            <box
              border
              borderStyle="rounded"
              borderColor={isSettingsTab() ? COLORS.agent : COLORS.success}
              paddingX={2}
              paddingY={1}
              marginTop={1}
              backgroundColor={COLORS.bgContent}
            >
              <box flexDirection="column">
                <Show when={isSettingsTab()} fallback={
                  <>
                    <text fg={COLORS.success} marginBottom={1}>
                      <strong>{tabLabels[activeTab()]} Configuration</strong>
                      <Show when={activeEntries()[agentTabIndex()]?.provider === "custom"}>
                        <span style={{ fg: COLORS.textFaint }}> (custom)</span>
                      </Show>
                    </text>
                    {renderField("Name ", active[agentTabIndex()].name, focusedField() === 0)}
                    {renderField("Tag  ", active[agentTabIndex()].tag, focusedField() === 1)}
                    {renderField("Model", active[agentTabIndex()].model, focusedField() === 2)}
                    <Show when={active[agentTabIndex()]?.provider === "custom"}>
                      {renderField("URL  ", active[agentTabIndex()].authUrl, focusedField() === 3)}
                      {renderTokenField("Token", active[agentTabIndex()].authToken, focusedField() === 4)}
                    </Show>
                  </>
                }>
                  <text fg={COLORS.agent} marginBottom={1}><strong>General Settings</strong></text>
                  {renderField("Name    ", settingsData.name, focusedField() === 0)}
                  {renderField("Tag     ", settingsData.tag, focusedField() === 1)}
                  {renderField("Max Hops", settingsData.maxHops, focusedField() === 2, "0 = unlimited")}
                  {renderField("Timeout ", settingsData.timeout, focusedField() === 3, "0 = unlimited")}
                </Show>
              </box>
            </box>

            {/* Shortcut bar */}
            <box flexDirection="row" marginTop={1} justifyContent="space-between">
              <text>
                <span style={{ fg: COLORS.textFaint }}>{"◂ "}</span>
                <span style={{ fg: COLORS.success }}>{"["}</span>
                <span style={{ fg: COLORS.textFaint }}>{" prev  "}</span>
                <span style={{ fg: COLORS.success }}>{"]"}</span>
                <span style={{ fg: COLORS.textFaint }}>{" next "}</span>
                <span style={{ fg: COLORS.textFaint }}>{"▸  "}</span>
                <span style={{ fg: COLORS.success }}>Tab</span>
                <span style={{ fg: COLORS.textFaint }}>{" fields  "}</span>
                <span style={{ fg: COLORS.success }}>Enter</span>
                <span style={{ fg: COLORS.textFaint }}>{" save & close"}</span>
                <span style={{ fg: COLORS.textFaint }}>{"  "}</span>
                <span style={{ fg: COLORS.warning }}>Esc</span>
                <span style={{ fg: COLORS.textFaint }}>{" back"}</span>
              </text>
            </box>

            <Show when={error()}>
              <box border borderStyle="rounded" borderColor={COLORS.error} paddingX={1} marginTop={1} backgroundColor={COLORS.bgError}>
                <text fg={COLORS.error}>{error()}</text>
              </box>
            </Show>
          </box>
        </box>
      </box>
    );
  };

  const DoneStep = () => (
    <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
      <box
        border
        borderStyle="double"
        borderColor={discoColor()}
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
            Press <span style={{ fg: COLORS.success }}><strong>Enter</strong></span> to continue
          </text>
        </box>
      </box>
    </box>
  );

  return (
    <>
      <Show when={step() === "detect"}>
        <DetectStep />
      </Show>
      <Show when={step() === "providers"}>
        <ProvidersStep />
      </Show>
      <Show when={step() === "configure"}>
        <ConfigureStep />
      </Show>
      <Show when={step() === "done"}>
        <DoneStep />
      </Show>
    </>
  );
}
