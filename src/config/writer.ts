import { writeFile, mkdir } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { PROVIDERS } from "./defaults.js";
import { LLM_PARTY_HOME } from "./loader.js";
import type { AppConfig, PersonaConfig } from "../types.js";

export interface AgentOverride {
  id: string;
  name?: string;
  tag?: string;
  model?: string;
}

export async function writeWizardConfig(
  selectedIds: string[],
  overrides?: AgentOverride[],
  existingConfig?: AppConfig
): Promise<string> {
  const overrideMap = new Map(
    (overrides || []).map((o) => [o.id, o])
  );

  // Build a lookup of existing agents by provider for preserving env and other fields
  const existingByProvider = new Map<string, PersonaConfig>();
  if (existingConfig?.agents) {
    for (const agent of existingConfig.agents) {
      existingByProvider.set(agent.provider, agent);
    }
  }

  const agents: PersonaConfig[] = selectedIds.map((id) => {
    const def = PROVIDERS.find((p) => p.id === id);
    if (!def) throw new Error(`Unknown provider: ${id}`);

    const override = overrideMap.get(id);
    const existing = existingByProvider.get(id);
    const agent: PersonaConfig = {
      name: override?.name || def.displayName,
      tag: override?.tag || def.defaultTag,
      provider: def.id,
      model: override?.model || def.defaultModel,
    };

    // Preserve env from existing config or use defaults
    if (existing?.env) {
      agent.env = { ...existing.env };
    } else if (def.env) {
      agent.env = { ...def.env };
    }

    // Preserve prompts and other fields from existing config
    if (existing?.prompts) agent.prompts = existing.prompts;
    if (existing?.preloadSkills) agent.preloadSkills = existing.preloadSkills;
    if (existing?.executablePath) agent.executablePath = existing.executablePath;
    if (existing?.timeout) agent.timeout = existing.timeout;

    return agent;
  });

  const config: AppConfig = {
    humanName: existingConfig?.humanName || userInfo().username || "USER",
    humanTag: existingConfig?.humanTag,
    maxAutoHops: existingConfig?.maxAutoHops ?? 15,
    timeout: existingConfig?.timeout,
    reminderInterval: existingConfig?.reminderInterval,
    agents,
  };

  // Clean undefined fields
  if (!config.humanTag) delete config.humanTag;
  if (config.timeout === undefined) delete config.timeout;
  if (config.reminderInterval === undefined) delete config.reminderInterval;

  await mkdir(LLM_PARTY_HOME, { recursive: true });
  const configPath = path.join(LLM_PARTY_HOME, "config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return configPath;
}
